import threading
import time
import pickle
import json
import os
import subprocess
import tempfile
from puresnmp import walk, get

# Initialize a threading event and a reference to the continuous execution thread
stop_event = threading.Event()
continuous_thread = None

def fetch_and_export_printers(printers, model_OID, ink_levels_base_OID, tray_current_capacity_base_OID, error_base_OID):
    printer_data = []
    for printer in printers:
        printer_info = {
            "IP": printer["IP"],
            "Name": printer["Name"],
            "Serial": printer["Serial"],
            "EID": printer["EID"],
            "Default": printer["Default"]
        }

        # SNMP fetch model
        try:
            model = get(printer['IP'], 'public', model_OID).decode('utf-8')
            printer_info["Model"] = model
        except Exception as e:
            printer_info["Model"] = "Error fetching model"

        # SNMP fetch ink levels
        try:
            ink_levels = [str(item[1]) + '%' for item in walk(printer['IP'], 'public', ink_levels_base_OID) if item]
            printer_info["Ink Levels"] = ink_levels
        except Exception as e:
            printer_info["Ink Levels"] = ["Error fetching ink levels"]

        # SNMP fetch tray information
        try:
            tray_info = [str(item[1]) for item in walk(printer['IP'], 'public', tray_current_capacity_base_OID)]
            printer_info["Tray Information"] = tray_info
        except Exception as e:
            printer_info["Tray Information"] = ["Error fetching tray information"]

        # SNMP fetch errors
        try:
            errors = [item[1].decode('utf-8') for item in walk(printer['IP'], 'public', error_base_OID)]
            printer_info["Errors"] = errors
        except Exception as e:
            printer_info["Errors"] = ["Error fetching errors"]

        printer_data.append(printer_info)

    # Export data to JSON
    file_path = 'printer_data.json'
    try:
        with open(file_path, 'w') as json_file:
            json.dump(printer_data, json_file, indent=4)
        print(f"Data exported to {file_path} successfully.")
    except:
        print("Something went wrong with saving")

def load_printers(file_path):
    try:
        with open(file_path, 'rb') as f:
            printers = pickle.load(f)
    except Exception as e:
        printers = []  # Fallback to an empty list if loading fails
        print(f"Error loading printers from {file_path}: {e}")
    return printers

def continuous_execution(file_path, interval, stop_event):
    global continuous_thread
    while not stop_event.is_set():
        printers = load_printers(file_path)
        # Example OIDs, replace with actual OIDs for your printers
        model_OID = '.1.3.6.1.2.1.43.5.1.1.16.1'
        ink_levels_base_OID = '.1.3.6.1.2.1.43.11.1.1.9.1'
        tray_current_capacity_base_OID = '.1.3.6.1.2.1.43.8.2.1.10.1'
        error_base_OID = '.1.3.6.1.2.1.43.18.1.1.8.1'
        fetch_and_export_printers(printers, model_OID, ink_levels_base_OID, tray_current_capacity_base_OID, error_base_OID)
        time.sleep(interval)

def start_continuous_thread(file_path, interval):
    global stop_event, continuous_thread
    if continuous_thread is not None:
        stop_event.set()
        continuous_thread.join()
    stop_event.clear()
    continuous_thread = threading.Thread(target=continuous_execution, args=(file_path, interval, stop_event))
    continuous_thread.daemon = True
    continuous_thread.start()

def open_and_edit_pkl(file_path):
    try:
        with open(file_path, 'rb') as f:
            data = pickle.load(f)
        temp_file = tempfile.NamedTemporaryFile(mode='w+t', delete=False, suffix='.json')
        json.dump(data, temp_file, indent=4)
        temp_file.close()
        
        if os.name == 'posix':
            subprocess.call(['open', temp_file.name])
        elif os.name == 'nt':
            subprocess.call(['open', temp_file.name])
        else:
            print("Platform not supported for opening a text editor")
            return
        
        input("Press Enter here after you have saved the file in the editor...")
        
        with open(temp_file.name, 'r') as f:
            edited_data = json.load(f)
        os.unlink(temp_file.name)
        
        with open(file_path, 'wb') as f:
            pickle.dump(edited_data, f)
        print("Successfully updated the .pkl file.")
    except Exception as e:
        print(f"Failed to open and edit the .pkl file: {e}")

# Global variables for the control panel to modify
run_interval = 30
printers_file = 'Printers.pkl'

def control_panel():
    global run_interval, printers_file
    while True:
        print("\nControl Panel:")
        print("1. Change run interval")
        print("2. Edit .pkl file")
        print("3. Exit")
        choice = input("Enter your choice: ")
        if choice == "1":
            new_interval = int(input("New run interval (seconds): "))
            run_interval = new_interval
            start_continuous_thread(printers_file, run_interval)
            print(f"Run interval set to {run_interval} seconds.")
        elif choice == "2":
            open_and_edit_pkl(printers_file)
        elif choice == "3":
            stop_event.set()
            print("Exiting control panel...")
            break
        else:
            print("Invalid choice, please select 1, 2, or 3.")

if __name__ == "__main__":
    start_continuous_thread(printers_file, run_interval)
    control_panel()