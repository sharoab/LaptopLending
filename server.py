import http.server
import socketserver
import json
import os
import sys
import mimetypes
import socket
from datetime import datetime

# Ensure utf-8 output on Windows consoles
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PORT = 8000
DATA_FILE = os.path.join(os.path.dirname(__file__), 'cart_data.json')
PUBLIC_DIR = os.path.join(os.path.dirname(__file__))

def get_initial_state():
    laptops = []
    # Initialize 12 laptops (1 to 12)
    # Give a couple of sample taken laptops so the admin/user immediately sees rich live data,
    # or start with laptop 4 and 9 taken by sample teachers to test counter (10 free out of 12).
    now_iso = datetime.now().isoformat()
    for i in range(1, 13):
        laptops.append({
            "id": i,
            "isTaken": False,
            "takenBy": None,
            "takenEmail": None,
            "takenAt": None
        })
    return {
        "laptops": laptops,
        "adminEmails": ["sharonabudi@gmail.com", "iritulp@gmail.com", "zviajer@gmail.com"]
    }

def load_state():
    if not os.path.exists(DATA_FILE):
        state = get_initial_state()
        save_state(state)
        return state
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading state: {e}")
        return get_initial_state()

def save_state(state):
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving state: {e}")

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class LaptopManagerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, status_code, data):
        response_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_GET(self):
        url_path = self.path.split('?')[0]
        if url_path == '/api/state':
            state = load_state()
            state["localIp"] = get_local_ip()
            state["serverPort"] = self.server.server_address[1]
            self.send_json(200, state)
            return
        
        # Route root or html
        if url_path == '/' or url_path == '/index.html':
            index_path = os.path.join(PUBLIC_DIR, 'index.html')
            if os.path.exists(index_path):
                with open(index_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        return super().do_GET()

    def do_POST(self):
        url_path = self.path.split('?')[0]
        content_length = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b'{}'
        
        try:
            req_data = json.loads(body_bytes.decode('utf-8'))
        except Exception:
            req_data = {}

        state = load_state()
        laptops = state["laptops"]

        if url_path == '/api/borrow':
            user_name = req_data.get('userName', 'מורה ללא שם')
            user_email = req_data.get('userEmail', '')
            req_laptop_id = req_data.get('laptopId')

            # Check if user already holds a laptop
            existing = next((l for l in laptops if l["isTaken"] and (
                (user_email and l["takenEmail"] == user_email) or 
                (not user_email and l["takenBy"] == user_name)
            )), None)

            if existing:
                self.send_json(400, {
                    "error": f"כבר יש ברשותך מחשב פעיל (מחשב #{existing['id']}). לא ניתן להשאיל מחשב נוסף.",
                    "laptop": existing
                })
                return

            # Target laptop
            target_laptop = None
            if req_laptop_id is not None:
                try:
                    req_laptop_id = int(req_laptop_id)
                    target_laptop = next((l for l in laptops if l["id"] == req_laptop_id), None)
                    if not target_laptop:
                        self.send_json(404, {"error": "מחשב לא נמצא"})
                        return
                    if target_laptop["isTaken"]:
                        self.send_json(400, {"error": f"מחשב מס' {req_laptop_id} כבר תפוס על ידי {target_laptop['takenBy']}"})
                        return
                except ValueError:
                    pass

            if not target_laptop:
                # Find the lowest numbered free laptop
                target_laptop = next((l for l in laptops if not l["isTaken"]), None)

            if not target_laptop:
                self.send_json(400, {"error": "מצטערים, אין כרגע מחשבים פנויים בעגלה."})
                return

            # Assign laptop
            target_laptop["isTaken"] = True
            target_laptop["takenBy"] = user_name
            target_laptop["takenEmail"] = user_email
            target_laptop["takenAt"] = datetime.now().isoformat()

            save_state(state)
            self.send_json(200, {
                "success": True,
                "message": f"מחשב מס' {target_laptop['id']} הוקצה לך בהצלחה!",
                "laptop": target_laptop,
                "state": state
            })
            return

        elif url_path == '/api/return':
            user_email = req_data.get('userEmail', '')
            user_name = req_data.get('userName', '')
            laptop_id = req_data.get('laptopId')

            target_laptop = None
            if laptop_id:
                try:
                    target_laptop = next((l for l in laptops if l["id"] == int(laptop_id)), None)
                except ValueError:
                    pass
            elif user_email:
                target_laptop = next((l for l in laptops if l["isTaken"] and l["takenEmail"] == user_email), None)
            elif user_name:
                target_laptop = next((l for l in laptops if l["isTaken"] and l["takenBy"] == user_name), None)

            if not target_laptop or not target_laptop["isTaken"]:
                self.send_json(400, {"error": "לא נמצא מחשב מושאל להחזרה."})
                return

            num = target_laptop["id"]
            target_laptop["isTaken"] = False
            target_laptop["takenBy"] = None
            target_laptop["takenEmail"] = None
            target_laptop["takenAt"] = None

            save_state(state)
            self.send_json(200, {
                "success": True,
                "message": f"מחשב מס' {num} הוחזר בהצלחה, תודה!",
                "returnedId": num,
                "state": state
            })
            return

        elif url_path == '/api/admin/reset':
            laptop_id = req_data.get('laptopId')
            try:
                target_laptop = next((l for l in laptops if l["id"] == int(laptop_id)), None)
            except (ValueError, TypeError):
                target_laptop = None

            if not target_laptop:
                self.send_json(404, {"error": "מחשב לא נמצא"})
                return

            target_laptop["isTaken"] = False
            target_laptop["takenBy"] = None
            target_laptop["takenEmail"] = None
            target_laptop["takenAt"] = None

            save_state(state)
            self.send_json(200, {
                "success": True,
                "message": f"מחשב מס' {laptop_id} אופס ושוחרר בהצלחה למצב פנוי.",
                "state": state
            })
            return

        elif url_path == '/api/admin/reset-all':
            for l in laptops:
                l["isTaken"] = False
                l["takenBy"] = None
                l["takenEmail"] = None
                l["takenAt"] = None

            save_state(state)
            self.send_json(200, {
                "success": True,
                "message": "כל 12 המחשבים שוחררו ואופסו בהצלחה למצב פנוי!",
                "state": state
            })
            return

        self.send_json(404, {"error": "Endpoint not found"})

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def run():
    local_ip = get_local_ip()
    port = PORT
    server = None
    for p in range(PORT, PORT + 20):
        try:
            server = ThreadedHTTPServer(("", p), LaptopManagerHandler)
            port = p
            break
        except OSError:
            continue

    if not server:
        print("Could not bind port.")
        return

    print("=" * 60)
    print(" 💻 אפליקציית ניהול השאלת מחשבים - עגלת מחשבים בית ספרית")
    print(f" 🌐 כתובת מקומית: http://localhost:{port}")
    print(f" 📱 גישה מהטלפון הנייד (ברשת ביה\"ס): http://{local_ip}:{port}")
    print("=" * 60)
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nשרת נעצר.")
        server.server_close()

if __name__ == '__main__':
    run()
