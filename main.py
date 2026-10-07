import sys
import os
from PySide6.QtWidgets import QApplication, QMainWindow, QSystemTrayIcon, QMenu
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineProfile
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtGui import QIcon, QPixmap, QPainter, QColor
from PySide6.QtCore import QObject, Slot, QUrl
import subprocess

class Api(QObject):
    def __init__(self, window):
        super().__init__()
        self.window = window
        self.locked = False
        self.is_maximized = False
        self.active_mode_id = ""
        self.active_task_type = ""
        self.playnite_was_running = False

    @Slot(str, str)
    def set_active_mode(self, mode_id, task_type):
        self.active_mode_id = mode_id
        self.active_task_type = task_type

    @Slot(str)
    def save_state(self, state_json):
        import os
        state_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json')
        try:
            with open(state_path, 'w', encoding='utf-8') as f:
                f.write(state_json)
        except Exception:
            pass

    @Slot(result=str)
    def load_state(self):
        import os
        state_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json')
        try:
            if os.path.exists(state_path):
                with open(state_path, 'r', encoding='utf-8') as f:
                    return f.read()
        except Exception:
            pass
        return "{}"

    @Slot()
    def lock_window(self):
        self.locked = True
        self.window.show()
        if not self.is_maximized:
            self.window.showMaximized()
            self.is_maximized = True

    @Slot()
    def unlock_window(self):
        self.locked = False
        self.window.showNormal()
        self.window.resize(800, 600)
        self.is_maximized = False

    @Slot()
    def bring_to_front(self):
        self.window.showNormal()
        self.window.activateWindow()

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Smart Pomodoro")
        self.resize(800, 600)

        # Enable persistent storage (localStorage)
        profile = QWebEngineProfile.defaultProfile()
        storage_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'storage')
        profile.setPersistentStoragePath(storage_path)

        # Setup WebEngineView
        self.browser = QWebEngineView()
        self.setCentralWidget(self.browser)

        # Setup WebChannel
        self.channel = QWebChannel()
        self.api = Api(self)
        self.channel.registerObject("api", self.api)
        self.browser.page().setWebChannel(self.channel)

        html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'index.html')
        self.browser.setUrl(QUrl.fromLocalFile(html_path))
        
        # Setup process monitoring
        from PySide6.QtCore import QTimer
        self.process_timer = QTimer(self)
        self.process_timer.timeout.connect(self.check_playnite)
        self.process_timer.start(2000)

    def check_playnite(self):
        import ctypes
        from ctypes.wintypes import DWORD, CHAR, MAX_PATH
        TH32CS_SNAPPROCESS = 2
        class PROCESSENTRY32(ctypes.Structure):
            _fields_ = [('dwSize', DWORD), ('cntUsage', DWORD), ('th32ProcessID', DWORD), ('th32DefaultHeapID', ctypes.POINTER(DWORD)), ('th32ModuleID', DWORD), ('cntThreads', DWORD), ('th32ParentProcessID', DWORD), ('pcPriClassBase', DWORD), ('dwFlags', DWORD), ('szExeFile', CHAR * MAX_PATH)]

        kernel32 = ctypes.windll.kernel32
        h_snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        
        is_running = False
        if h_snap != -1:
            pe = PROCESSENTRY32()
            pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
            if kernel32.Process32First(h_snap, ctypes.byref(pe)):
                while True:
                    exe = pe.szExeFile.decode('utf-8', 'ignore').lower()
                    if 'playnite' in exe:
                        is_running = True
                        break
                    if not kernel32.Process32Next(h_snap, ctypes.byref(pe)):
                        break
            kernel32.CloseHandle(h_snap)
            
        active_type = self.api.active_task_type
        
        if active_type == 'productive':
            if is_running:
                import subprocess
                try:
                    subprocess.run(['taskkill', '/F', '/IM', 'Playnite*'], creationflags=subprocess.CREATE_NO_WINDOW)
                    self.browser.page().runJavaScript("showStrictAlert('Игры заблокированы во время работы!')")
                except:
                    pass
        else:
            if is_running and not self.api.playnite_was_running:
                self.browser.page().runJavaScript("startGamingTimer()")
                # Minimize window but keep working
                self.hide()
            elif not is_running and self.api.playnite_was_running:
                if active_type == 'reward':
                    self.browser.page().runJavaScript("stopTimer()")
                    
        self.api.playnite_was_running = is_running

    def closeEvent(self, event):
        if self.api.locked:
            event.ignore()
        else:
            # Minimize to tray instead of closing
            event.ignore()
            self.hide()

def create_icon():
    # Create a simple icon pixmap
    pixmap = QPixmap(64, 64)
    pixmap.fill(QColor(10, 10, 26))
    painter = QPainter(pixmap)
    painter.setBrush(QColor(0, 255, 204))
    painter.drawEllipse(10, 10, 44, 44)
    painter.end()
    return QIcon(pixmap)

def create_shortcut():
    try:
        import ctypes
        import ctypes.wintypes
        
        # Get actual Desktop path (handles OneDrive redirects)
        CSIDL_DESKTOP = 0
        buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
        ctypes.windll.shell32.SHGetFolderPathW(None, CSIDL_DESKTOP, None, 0, buf)
        desktop_path = buf.value
        
        shortcut_path = os.path.join(desktop_path, 'Smart Pomodoro.lnk')
        
        if not os.path.exists(shortcut_path):
            pythonw = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
            script_path = os.path.abspath(__file__)
            work_dir = os.path.dirname(script_path)
            
            vbs_script = f"""
Set ws = CreateObject("WScript.Shell")
Set shortcut = ws.CreateShortcut("{shortcut_path}")
shortcut.TargetPath = "{pythonw}"
shortcut.Arguments = Chr(34) & "{script_path}" & Chr(34)
shortcut.WorkingDirectory = "{work_dir}"
shortcut.IconLocation = "{pythonw},0"
shortcut.Save
"""
            vbs_path = os.path.join(work_dir, 'create_shortcut.vbs')
            with open(vbs_path, 'w', encoding='utf-16') as f:
                f.write(vbs_script)
            
            subprocess.run(['cscript.exe', '//Nologo', '//U', vbs_path], creationflags=0x08000000)
            
            try:
                os.remove(vbs_path)
            except Exception:
                pass
                
    except Exception:
        pass

if __name__ == '__main__':
    app = QApplication(sys.argv)
    
    # Single instance lock and IPC
    from PySide6.QtNetwork import QLocalSocket, QLocalServer
    server_name = "SmartPomodoro_SingleInstance"
    
    socket = QLocalSocket()
    socket.connectToServer(server_name)
    if socket.waitForConnected(500):
        # App is already running, send wake up signal
        socket.write(b"WAKE_UP")
        socket.flush()
        socket.waitForBytesWritten(500)
        sys.exit(0)
        
    create_shortcut()
    
    # Keep app running even if window is closed
    app.setQuitOnLastWindowClosed(False)

    window = MainWindow()
    window.show()

    # System Tray Setup
    tray_icon = QSystemTrayIcon(create_icon(), app)
    tray_icon.setToolTip("Smart Pomodoro")

    menu = QMenu()
    
    open_action = menu.addAction("Open")
    open_action.triggered.connect(lambda: (window.showNormal(), window.activateWindow()))

    exit_action = menu.addAction("Exit")
    exit_action.triggered.connect(app.quit)

    tray_icon.setContextMenu(menu)
    tray_icon.show()

    # If icon is double clicked, open the window
    def on_tray_activated(reason):
        if reason == QSystemTrayIcon.DoubleClick:
            window.showNormal()
            window.activateWindow()
            
    tray_icon.activated.connect(on_tray_activated)

    # Start local server to listen for future instances
    server = QLocalServer()
    server.removeServer(server_name)
    server.listen(server_name)
    
    def handle_new_connection():
        client = server.nextPendingConnection()
        if client.waitForReadyRead(500):
            msg = client.readAll()
            if msg == b"WAKE_UP":
                window.showNormal()
                window.activateWindow()
        client.disconnectFromServer()
        
    server.newConnection.connect(handle_new_connection)

    sys.exit(app.exec())
