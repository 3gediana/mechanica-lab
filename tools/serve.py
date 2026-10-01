#!/usr/bin/env python3
"""开发服务器：python http.server 补 .mjs MIME（Windows 注册表缺 .mjs 映射，Chrome 会拒载模块）"""
import http.server, sys

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".wasm": "application/wasm"}

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8721
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
