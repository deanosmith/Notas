import Foundation
import Network

// Firebase persistence and the renderer's local preferences need a stable web origin.
final class RendererServer: Sendable {
    static let portRange = 49152...65535

    private let listener: NWListener
    private let queue = DispatchQueue(label: "com.deanmsmith.notas.renderer")
    private let assets: [String: Asset]
    private let completeSignIn: @Sendable (Data) async -> Bool
    private static let maximumHeaderBytes = 8192
    private static let maximumBodyBytes = 16_384

    private struct Asset: Sendable {
        let data: Data
        let contentType: String
    }

    init(resources: URL, port: UInt16, completeSignIn: @escaping @Sendable (Data) async -> Bool) throws {
        var assets: [String: Asset] = [:]
        let files = ["index.html", "styles.css", "firebase-config.local.js", "notas.png", "notas-icon.png",
                     "BrowserSignIn.html", "BrowserSignIn.js"]
        let scripts = try FileManager.default.contentsOfDirectory(atPath: resources.appendingPathComponent("js").path)
            .filter { $0.hasSuffix(".js") }.map { "js/\($0)" }
        for path in files + scripts {
            let url = resources.appendingPathComponent(path)
            let contentType: String
            switch url.pathExtension {
            case "html": contentType = "text/html; charset=utf-8"
            case "css": contentType = "text/css; charset=utf-8"
            case "js": contentType = "text/javascript; charset=utf-8"
            default: contentType = "image/png"
            }
            assets["/\(path)"] = Asset(data: try Data(contentsOf: url), contentType: contentType)
        }
        self.assets = assets
        self.completeSignIn = completeSignIn

        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!)
        listener = try NWListener(using: parameters)
    }

    func start() async throws -> URL {
        let port = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    self.listener.stateUpdateHandler = nil
                    if let port = self.listener.port?.rawValue {
                        continuation.resume(returning: port)
                    } else {
                        continuation.resume(throwing: URLError(.cannotConnectToHost))
                    }
                case .failed(let error), .waiting(let error):
                    self.listener.stateUpdateHandler = nil
                    self.listener.cancel()
                    continuation.resume(throwing: error)
                case .cancelled:
                    self.listener.stateUpdateHandler = nil
                    continuation.resume(throwing: CancellationError())
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self, let port = self.listener.port?.rawValue else {
                    connection.cancel()
                    return
                }
                connection.start(queue: self.queue)
                self.queue.asyncAfter(deadline: .now() + 5) { connection.cancel() }
                self.readRequest(connection, host: "localhost:\(port)", buffer: Data())
            }
            listener.start(queue: queue)
        }
        // The listener binds IPv4 loopback only; localhost also gives WebKit a secure context.
        return URL(string: "http://localhost:\(port)/")!
    }

    deinit { listener.cancel() }

    private func readRequest(_ connection: NWConnection, host: String, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] received, _, complete, error in
            guard let self, error == nil, let received else {
                connection.cancel()
                return
            }
            var data = buffer
            data.append(received)
            if let end = data.range(of: Data("\r\n\r\n".utf8)) {
                guard end.upperBound <= Self.maximumHeaderBytes else {
                    self.send(self.http("431 Request Header Fields Too Large"), to: connection)
                    return
                }
                let headers = String(decoding: data[..<end.lowerBound], as: UTF8.self)
                let body = Data(data[end.upperBound...])
                switch self.request(headers, host: host) {
                case .asset(let response):
                    self.send(response, to: connection)
                    return
                case .signIn(let length):
                    guard body.count <= length else {
                        self.send(self.http("400 Bad Request"), to: connection)
                        return
                    }
                    if body.count == length {
                        Task {
                            let accepted = await self.completeSignIn(body)
                            self.send(self.http(accepted ? "204 No Content" : "410 Gone"), to: connection)
                        }
                        return
                    }
                }
            } else if data.count >= Self.maximumHeaderBytes {
                self.send(self.http("431 Request Header Fields Too Large"), to: connection)
                return
            }
            guard !complete else { connection.cancel(); return }
            self.readRequest(connection, host: host, buffer: data)
        }
    }

    private enum Request {
        case asset(Data)
        case signIn(length: Int)
    }

    private func request(_ request: String, host: String) -> Request {
        let lines = request.components(separatedBy: "\r\n")
        let parts = lines.first?.split(separator: " ") ?? []
        var headers: [String: [String]] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { return .asset(http("400 Bad Request")) }
            let key = line[..<colon].lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[key, default: []].append(value)
        }
        guard parts.count == 3, headers["host"] == [host] else { return .asset(http("400 Bad Request")) }
        if parts[0] == "POST", parts[1] == "/complete-sign-in" {
            guard headers["origin"] == ["http://\(host)"],
                  headers["content-type"] == ["application/json"],
                  headers["transfer-encoding"] == nil,
                  let sizes = headers["content-length"], sizes.count == 1,
                  let length = Int(sizes[0]), (1...Self.maximumBodyBytes).contains(length) else {
                return .asset(http("400 Bad Request"))
            }
            return .signIn(length: length)
        }
        let isHead = parts[0] == "HEAD"
        guard parts[0] == "GET" || isHead else { return .asset(http("405 Method Not Allowed")) }
        let path = parts[1].split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first
        guard let path, let asset = assets[path == "/" ? "/index.html" : String(path)] else {
            return .asset(http("404 Not Found"))
        }
        return .asset(http("200 OK", asset: asset, head: isHead))
    }

    private func send(_ response: Data, to connection: NWConnection) {
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }

    private func http(_ status: String, asset: Asset? = nil, head: Bool = false) -> Data {
        let body = asset?.data ?? Data()
        var response = Data("""
            HTTP/1.1 \(status)\r
            Content-Type: \(asset?.contentType ?? "text/plain")\r
            Content-Length: \(body.count)\r
            Connection: close\r
            Cache-Control: no-store\r
            X-Content-Type-Options: nosniff\r
            Cross-Origin-Resource-Policy: same-origin\r
            Content-Security-Policy: frame-ancestors 'none'\r
            \r

            """.utf8)
        if !head { response.append(body) }
        return response
    }
}
