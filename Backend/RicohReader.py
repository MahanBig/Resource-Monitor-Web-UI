import threading
import time
import json
import os
import tkinter as tk
from tkinter import scrolledtext, messagebox
from datetime import datetime
from puresnmp import walk, get
import paramiko

# Constants
DEFAULT_PRINTERS_FILE = 'Printers.json'
DEFAULT_INTERVAL = 40
CREDENTIALS_FILE = 'credentials.json'

# SNMP OIDs
MODEL_OID = '.1.3.6.1.2.1.43.5.1.1.16.1'
INK_LEVELS_OID = '.1.3.6.1.2.1.43.11.1.1.9.1'
TRAY_CAPACITY_OID = '.1.3.6.1.2.1.43.8.2.1.10.1'
ERROR_OID = '.1.3.6.1.2.1.43.18.1.1.8.1'

class PrinterMonitor:
    def __init__(self):
        self.stop_event = threading.Event()
        self.continuous_thread = None
        self.run_interval = DEFAULT_INTERVAL
        self.printers_file = DEFAULT_PRINTERS_FILE

    class SNMPFetcher:
        @staticmethod
        def get_printer_data(printer):
            """Fetch all SNMP data for a single printer."""
            return {
                "Model": PrinterMonitor.SNMPFetcher._get_model(printer),
                "Ink Levels": PrinterMonitor.SNMPFetcher._get_ink_levels(printer),
                "Tray Information": PrinterMonitor.SNMPFetcher._get_tray_info(printer),
                "Errors": PrinterMonitor.SNMPFetcher._get_errors(printer)
            }

        @staticmethod
        def _get_model(printer):
            try:
                model = get(printer['IP'], 'public', MODEL_OID).decode('utf-8', errors='ignore')
                return model.replace(" ", "-")
            except Exception:
                return "Error fetching model"

        @staticmethod
        def _get_ink_levels(printer):
            try:
                return [f"{item[1]}%" for item in walk(printer['IP'], 'public', INK_LEVELS_OID) if item]
            except Exception:
                return ["Error fetching ink levels"]

        @staticmethod
        def _get_tray_info(printer):
            try:
                return [str(item[1]) for item in walk(printer['IP'], 'public', TRAY_CAPACITY_OID)]
            except Exception:
                return ["Error fetching tray information"]

        @staticmethod
        def _get_errors(printer):
            try:
                return [item[1].decode('utf-8', errors='ignore') 
                        for item in walk(printer['IP'], 'public', ERROR_OID)]
            except Exception:
                return ["Error fetching errors"]

    class SFTPManager:
        @staticmethod
        def upload_file(file_path):
            """Upload file to SFTP server using credentials from JSON file."""
            try:
                with open(CREDENTIALS_FILE) as f:
                    credentials = json.load(f)
                
                with paramiko.SSHClient() as ssh:
                    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    ssh.connect(
                        credentials['host'],
                        port=credentials['port'],
                        username=credentials['user'],
                        password=credentials['pass']
                    )
                    
                    with ssh.open_sftp() as sftp:
                        sftp.chdir(credentials['path'])
                        sftp.put(file_path, os.path.basename(file_path))
                        
                print(f"Uploaded {file_path} to SFTP server successfully.")
            except Exception as e:
                print(f"SFTP upload failed: {e}")

    def _load_printers(self):
        """Load printers from JSON file with error handling."""
        try:
            with open(self.printers_file) as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading printers: {e}")
            return []

    def _export_data(self, printer_data):
        """Export data to JSON file and upload via SFTP."""
        try:
            with open('printer_data.json', 'w') as f:
                json.dump(printer_data, f, indent=4)
            
            self.SFTPManager.upload_file('printer_data.json')
        except Exception as e:
            print(f"Data export failed: {e}")

    def _continuous_monitoring(self, interval):
        """Continuous monitoring loop."""
        while not self.stop_event.is_set():
            printers = self._load_printers()
            printer_data = []
            
            for printer in printers:
                data = {
                    "IP": printer["IP"],
                    "Name": printer["Name"],
                    "Serial": printer["Serial"],
                    "EID": printer["EID"],
                    "Default": printer["Default"],
                    "Time": datetime.now().strftime('%d %m %Y, %H:%M')
                }
                data.update(self.SNMPFetcher.get_printer_data(printer))
                printer_data.append(data)
            
            self._export_data(printer_data)
            time.sleep(interval)

    def start_monitoring(self):
        """Start the continuous monitoring thread."""
        if self.continuous_thread and self.continuous_thread.is_alive():
            self.stop_monitoring()
        
        self.stop_event.clear()
        self.continuous_thread = threading.Thread(
            target=self._continuous_monitoring,
            args=(self.run_interval,)
        )
        self.continuous_thread.daemon = True
        self.continuous_thread.start()

    def stop_monitoring(self):
        """Stop the continuous monitoring thread."""
        self.stop_event.set()
        if self.continuous_thread:
            self.continuous_thread.join()

    class JSONEditor:
        @staticmethod
        def edit_file(file_path):
            """Open a GUI editor for JSON files."""
            try:
                with open(file_path) as f:
                    data = json.load(f)
                
                json_str = json.dumps(data, indent=4)
                editor = tk.Tk()
                editor.title(f"Editing {file_path}")
                
                text_area = scrolledtext.ScrolledText(editor, wrap=tk.WORD, width=80, height=20)
                text_area.pack(padx=10, pady=10)
                text_area.insert(tk.INSERT, json_str)
                
                def save_changes():
                    try:
                        new_data = json.loads(text_area.get(1.0, tk.END))
                        with open(file_path, 'w') as f:
                            json.dump(new_data, f, indent=4)
                        messagebox.showinfo("Success", "File updated successfully")
                        editor.destroy()
                    except Exception as e:
                        messagebox.showerror("Error", f"Invalid JSON: {e}")
                
                tk.Button(editor, text="Save", command=save_changes).pack(pady=5)
                editor.mainloop()
            
            except Exception as e:
                messagebox.showerror("Error", f"Failed to open file: {e}")

    def control_panel(self):
        """Command line interface for controlling the monitor."""
        while True:
            print("\nPrinter Monitor Control Panel:")
            print("1. Change update interval")
            print("2. Edit printers file")
            print("3. Exit")
            
            choice = input("Enter choice: ").strip()
            
            if choice == "1":
                try:
                    self.run_interval = int(input("New interval (seconds): "))
                    self.start_monitoring()
                    print(f"Update interval set to {self.run_interval}s")
                except ValueError:
                    print("Invalid number format")
            
            elif choice == "2":
                self.JSONEditor.edit_file(self.printers_file)
                self.start_monitoring()
            
            elif choice == "3":
                self.stop_monitoring()
                print("Exiting...")
                break
            
            else:
                print("Invalid choice")

if __name__ == "__main__":
    monitor = PrinterMonitor()
    monitor.start_monitoring()
    monitor.control_panel()