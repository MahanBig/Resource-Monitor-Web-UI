import json
import os
import threading
import time
from datetime import datetime
from tkinter import messagebox, scrolledtext
import tkinter as tk

import paramiko
from puresnmp import get, walk

# --- Configuration ---

# OID (Object Identifier) constants for SNMP requests
MODEL_OID = ".1.3.6.1.2.1.43.5.1.1.16.1"
INK_LEVELS_BASE_OID = ".1.3.6.1.2.1.43.11.1.1.9.1"
TRAY_CAPACITY_BASE_OID = ".1.3.6.1.2.1.43.8.2.1.10.1"
ERROR_BASE_OID = ".1.3.6.1.2.1.43.18.1.1.8.1"

# --- Helper Functions ---

def load_config(file_path: str) -> dict:
    """Loads a JSON configuration file."""
    try:
        with open(file_path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error loading {file_path}: {e}")
        return {}

# --- Classes ---

class Printer:
    """Represents a single printer and its SNMP data."""

    def __init__(self, ip: str, name: str, serial: str, eid: str, default: bool):
        self.ip = ip
        self.name = name
        self.serial = serial
        self.eid = eid
        self.default = default

    def _fetch_snmp_data(self, oid: str, is_walk: bool = False) -> list | str:
        """Fetches data from the printer using SNMP."""
        try:
            if is_walk:
                return [item[1] for item in walk(self.ip, "public", oid) if item]
            return get(self.ip, "public", oid).decode("utf-8", errors="ignore")
        except Exception as e:
            return f"Error fetching data: {e}"

    def get_data(self) -> dict:
        """Retrieves all monitored data for the printer."""
        now = datetime.now().strftime("%d %m %Y, %H:%M")
        model = self._fetch_snmp_data(MODEL_OID)
        ink_levels = self._fetch_snmp_data(INK_LEVELS_BASE_OID, is_walk=True)
        tray_info = self._fetch_snmp_data(TRAY_CAPACITY_BASE_OID, is_walk=True)
        errors = self._fetch_snmp_data(ERROR_BASE_OID, is_walk=True)

        return {
            "IP": self.ip,
            "Name": self.name,
            "Serial": self.serial,
            "EID": self.eid,
            "Default": self.default,
            "Time": now,
            "Model": model.replace(" ", "-") if isinstance(model, str) else model,
            "Ink Levels": [f"{level}%" for level in ink_levels] if isinstance(ink_levels, list) else [ink_levels],
            "Tray Information": tray_info if isinstance(tray_info, list) else [tray_info],
            "Errors": [err.decode("utf-8", errors="ignore") for err in errors] if isinstance(errors, list) else [errors],
        }

class SFTPServer:
    """Handles the connection and file uploading to an SFTP server."""

    def __init__(self, credentials: dict):
        self.host = credentials.get("host")
        self.port = credentials.get("port", 22)
        self.user = credentials.get("user")
        self.password = credentials.get("pass")
        self.path = credentials.get("path")

    def upload_file(self, local_path: str):
        """Uploads a file to the SFTP server."""
        if not all([self.host, self.user, self.password, self.path]):
            print("SFTP credentials are not fully configured.")
            return

        try:
            with paramiko.SSHClient() as ssh:
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                ssh.connect(self.host, port=self.port, username=self.user, password=self.password)
                with ssh.open_sftp() as sftp:
                    sftp.chdir(self.path)
                    remote_path = os.path.basename(local_path)
                    sftp.put(local_path, remote_path)
                    print(f"Successfully uploaded {local_path} to {self.path}")
        except Exception as e:
            print(f"Failed to upload file to SFTP server: {e}")

class PrinterMonitor:
    """Monitors a list of printers and exports their data."""

    def __init__(self, printers_file: str, credentials_file: str):
        self.printers_file = printers_file
        self.credentials_file = credentials_file
        self.printers = self._load_printers()
        self.sftp_server = SFTPServer(load_config(self.credentials_file))

    def _load_printers(self) -> list[Printer]:
        """Loads the list of printers from the configuration file."""
        printers_config = load_config(self.printers_file)
        return [Printer(**p) for p in printers_config] if printers_config else []

    def fetch_and_export_data(self):
        """Fetches data from all printers and exports it to a JSON file."""
        printer_data = [printer.get_data() for printer in self.printers]
        output_file = "printer_data.json"

        try:
            with open(output_file, "w") as f:
                json.dump(printer_data, f, indent=4)
            print(f"Data exported to {output_file} successfully.")
            self.sftp_server.upload_file(output_file)
        except IOError as e:
            print(f"Error saving data to {output_file}: {e}")

# --- GUI and Control ---

class ControlPanel:
    """A simple Tkinter control panel for the application."""

    def __init__(self, monitor: PrinterMonitor):
        self.monitor = monitor
        self.run_interval = 40
        self.stop_event = threading.Event()
        self.continuous_thread = None

    def _continuous_execution(self):
        """The main loop for continuously fetching data."""
        while not self.stop_event.is_set():
            self.monitor.fetch_and_export_data()
            time.sleep(self.run_interval)

    def start_continuous_thread(self):
        """Starts the data fetching thread."""
        if self.continuous_thread and self.continuous_thread.is_alive():
            self.stop_event.set()
            self.continuous_thread.join()
        self.stop_event.clear()
        self.continuous_thread = threading.Thread(target=self._continuous_execution)
        self.continuous_thread.daemon = True
        self.continuous_thread.start()

    def open_and_edit_json(self):
        """Opens a Tkinter window to edit the printers JSON file."""
        try:
            with open(self.monitor.printers_file, "r") as f:
                json_data = f.read()

            editor_window = tk.Tk()
            editor_window.title(f"Edit {self.monitor.printers_file}")
            text_area = scrolledtext.ScrolledText(editor_window, wrap=tk.WORD, width=80, height=20)
            text_area.pack(padx=10, pady=10)
            text_area.insert(tk.INSERT, json_data)

            def save_changes():
                try:
                    edited_data = json.loads(text_area.get(1.0, tk.END))
                    with open(self.monitor.printers_file, "w") as f:
                        json.dump(edited_data, f, indent=4)
                    messagebox.showinfo("Success", f"Successfully updated {self.monitor.printers_file}.")
                    editor_window.destroy()
                    self.monitor.printers = self.monitor._load_printers()  # Reload printers
                except (IOError, json.JSONDecodeError) as e:
                    messagebox.showerror("Error", f"Failed to save the file: {e}")

            submit_button = tk.Button(editor_window, text="Submit", command=save_changes)
            submit_button.pack(pady=5)
            editor_window.mainloop()
        except Exception as e:
            messagebox.showerror("Error", f"Failed to open the file: {e}")

    def run(self):
        """Starts the control panel loop."""
        self.start_continuous_thread()
        while True:
            print("\nControl Panel:")
            print("1. Change run interval")
            print("2. Edit Printers.json file")
            print("3. Exit")
            choice = input("Enter your choice: ")

            if choice == "1":
                try:
                    new_interval = int(input("New run interval (seconds): "))
                    self.run_interval = new_interval
                    self.start_continuous_thread()
                    print(f"Run interval set to {self.run_interval} seconds.")
                except ValueError:
                    print("Invalid input. Please enter a number.")
            elif choice == "2":
                self.open_and_edit_json()
            elif choice == "3":
                self.stop_event.set()
                print("Exiting control panel...")
                break
            else:
                print("Invalid choice. Please select 1, 2, or 3.")

# --- Main Execution ---

if __name__ == "__main__":
    printers_file = "Printers.json"
    credentials_file = "credentials.json"
    
    monitor = PrinterMonitor(printers_file, credentials_file)
    panel = ControlPanel(monitor)
    panel.run()