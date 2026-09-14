import threading
import time
import pickle
import json
import os
import urllib.request
import urllib.error
from puresnmp import walk, get
import tkinter as tk
from tkinter import scrolledtext
from tkinter import messagebox
import paramiko
from datetime import datetime


stop_event = threading.Event()
continuous_thread = None

print(os.getcwd())


def decode_snmp_text(value):
    """
    Dekoder tekst fra Ricoh SNMP.

    Ricoh kan returnere tekst som enten UTF-8 eller Latin-1.
    Denne funksjonen prøver UTF-8 først og faller tilbake til Latin-1.
    """
    if isinstance(value, bytes):
        try:
            return value.decode('utf-8')
        except UnicodeDecodeError:
            return value.decode('latin-1')

    return str(value)


def fetch_and_export_printers(
    printers,
    model_OID,
    ink_levels_base_OID,
    tray_current_capacity_base_OID,
    error_base_OID
):
    now = datetime.now()
    currenttime = now.strftime('%d %m %Y, %H:%M')
    printer_data = []

    for printer in printers:
        printer_info = {
            "IP": printer["IP"],
            "Name": printer["Name"],
            "Serial": printer["Serial"],
            "EID": printer["EID"],
            "Default": printer["Default"],
            "Time": currenttime
        }

        # ---------------------------------------------------------
        # SNMP fetch model
        # ---------------------------------------------------------
        try:
            model_value = get(
                printer['IP'],
                'public',
                model_OID
            )

            model = decode_snmp_text(model_value).strip()

            printer_info["Model"] = model

        except Exception as e:
            print(
                f"Error fetching model from "
                f"{printer['Name']} ({printer['IP']}): "
                f"{type(e).__name__}: {repr(e)}"
            )

            printer_info["Model"] = "Error fetching model"

        # ---------------------------------------------------------
        # SNMP fetch ink levels
        # ---------------------------------------------------------
        try:
            ink_levels = []

            for item in walk(
                printer['IP'],
                'public',
                ink_levels_base_OID
            ):
                if not item:
                    continue

                ink_value = item[1]
                ink_levels.append(
                    f"{ink_value}%"
                )

            printer_info["Ink Levels"] = ink_levels

        except Exception as e:
            print(
                f"Error fetching ink levels from "
                f"{printer['Name']} ({printer['IP']}): "
                f"{type(e).__name__}: {repr(e)}"
            )

            printer_info["Ink Levels"] = [
                "Error fetching ink levels"
            ]

        # ---------------------------------------------------------
        # SNMP fetch tray information
        # ---------------------------------------------------------
        try:
            tray_info = []

            for item in walk(
                printer['IP'],
                'public',
                tray_current_capacity_base_OID
            ):
                if not item:
                    continue

                tray_info.append(
                    str(item[1])
                )

            printer_info["Tray Information"] = tray_info

        except Exception as e:
            print(
                f"Error fetching tray information from "
                f"{printer['Name']} ({printer['IP']}): "
                f"{type(e).__name__}: {repr(e)}"
            )

            printer_info["Tray Information"] = [
                "Error fetching tray information"
            ]

        # ---------------------------------------------------------
        # SNMP fetch errors
        # ---------------------------------------------------------
        try:
            errors = []

            for item in walk(
                printer['IP'],
                'public',
                error_base_OID
            ):
                if not item:
                    continue

                try:
                    value = item[1]

                    error_text = decode_snmp_text(
                        value
                    ).strip()

                    if error_text:
                        errors.append(error_text)

                except Exception as item_error:
                    print(
                        f"Could not decode error entry from "
                        f"{printer['Name']} "
                        f"({printer['IP']}): "
                        f"{type(item_error).__name__}: "
                        f"{repr(item_error)}"
                    )

            printer_info["Errors"] = errors

        except Exception as e:
            print(
                f"Error fetching errors from "
                f"{printer['Name']} "
                f"({printer['IP']}): "
                f"{type(e).__name__}: {repr(e)}"
            )

            printer_info["Errors"] = [
                "Error fetching errors"
            ]

        # Legg printeren til i snapshot
        printer_data.append(printer_info)

    # -------------------------------------------------------------
    # Export data to JSON
    # -------------------------------------------------------------
    file_path = 'printer_data.json'

    try:
        with open(
            file_path,
            'w',
            encoding='utf-8'
        ) as json_file:
            json.dump(
                printer_data,
                json_file,
                indent=4,
                ensure_ascii=False
            )

        print(
            f"Data exported to {file_path} successfully."
        )

    except Exception as e:
        print(
            f"Something went wrong with saving: "
            f"{type(e).__name__}: {repr(e)}"
        )

        return

    # -------------------------------------------------------------
    # Upload live JSON via SFTP
    # -------------------------------------------------------------
    try:
        uploadToSFTP(file_path)

    except Exception as e:
        print(
            f"Went wrong with upload: "
            f"{type(e).__name__}: {e}"
        )

    # -------------------------------------------------------------
    # Send samme snapshot til historikkloggeren
    # -------------------------------------------------------------
    try:
        trigger_event_logger(printer_data)

    except Exception as e:
        print(
            f"Event logger failed: {e}"
        )


def load_printers(file_path):
    try:
        with open(file_path, 'rb') as f:
            printers = pickle.load(f)

    except Exception as e:
        printers = []

        print(
            f"Error loading printers from "
            f"{file_path}: {e}"
        )

    return printers


def continuous_execution(
    file_path,
    interval,
    stop_event
):
    global continuous_thread

    while not stop_event.is_set():
        printers = load_printers(file_path)

        # Ricoh SNMP OIDs
        model_OID = (
            '.1.3.6.1.2.1.43.5.1.1.16.1'
        )

        ink_levels_base_OID = (
            '.1.3.6.1.2.1.43.11.1.1.9.1'
        )

        tray_current_capacity_base_OID = (
            '.1.3.6.1.2.1.43.8.2.1.10.1'
        )

        error_base_OID = (
            '.1.3.6.1.2.1.43.18.1.1.8.1'
        )

        fetch_and_export_printers(
            printers,
            model_OID,
            ink_levels_base_OID,
            tray_current_capacity_base_OID,
            error_base_OID
        )


        if stop_event.wait(interval):
            break


def start_continuous_thread(
    file_path,
    interval
):
    global stop_event
    global continuous_thread

    if (
        continuous_thread is not None
        and continuous_thread.is_alive()
    ):
        stop_event.set()
        continuous_thread.join(
            timeout=10
        )

    stop_event.clear()

    continuous_thread = threading.Thread(
        target=continuous_execution,
        args=(
            file_path,
            interval,
            stop_event
        )
    )

    continuous_thread.daemon = True
    continuous_thread.start()


def open_and_edit_pkl(file_path):
    try:
        with open(file_path, 'rb') as f:
            data = pickle.load(f)

        # Convert data to a JSON string for editing
        json_data = json.dumps(
            data,
            indent=4,
            ensure_ascii=False
        )

        def save_changes():
            try:
                edited_data = json.loads(
                    text_area.get(
                        1.0,
                        tk.END
                    )
                )

                with open(
                    file_path,
                    'wb'
                ) as f:
                    pickle.dump(
                        edited_data,
                        f
                    )

                messagebox.showinfo(
                    "Success",
                    "Successfully updated the .pkl file."
                )

                editor_window.destroy()

                start_continuous_thread(
                    printers_file,
                    run_interval
                )

            except Exception as e:
                messagebox.showerror(
                    "Error",
                    f"Failed to save the .pkl file: {e}"
                )

        # Create a Tkinter window
        editor_window = tk.Tk()

        editor_window.title(
            "Edit .pkl File"
        )

        # Add a scrolled text widget
        text_area = scrolledtext.ScrolledText(
            editor_window,
            wrap=tk.WORD,
            width=80,
            height=20
        )

        text_area.pack(
            padx=10,
            pady=10
        )

        text_area.insert(
            tk.INSERT,
            json_data
        )

        # Add a Submit button
        submit_button = tk.Button(
            editor_window,
            text="Submit",
            command=save_changes
        )

        submit_button.pack(
            pady=5
        )

        editor_window.mainloop()

    except Exception as e:
        messagebox.showerror(
            "Error",
            f"Failed to open and edit the .pkl file: {e}"
        )


def load_credentials():
    with open(
        'credentials.json',
        'r',
        encoding='utf-8'
    ) as f:
        return json.load(f)


def uploadToSFTP(filetoupload):
    """
    Upload printer_data.json atomisk slik at frontend
    aldri leser en halv JSON-fil.
    """

    credentials = load_credentials()

    sftp_server = credentials['host']

    sftp_port = credentials.get(
        'port',
        22
    )

    sftp_username = credentials['user']
    sftp_password = credentials['pass']
    sftp_target_path = credentials['path']

    ssh = None
    sftp = None

    try:
        ssh = paramiko.SSHClient()

        ssh.set_missing_host_key_policy(
            paramiko.AutoAddPolicy()
        )

        ssh.connect(
            sftp_server,
            port=sftp_port,
            username=sftp_username,
            password=sftp_password,
            timeout=15
        )

        sftp = ssh.open_sftp()

        sftp.chdir(
            sftp_target_path
        )

        filename = os.path.basename(
            filetoupload
        )

        temp_filename = (
            filename + '.uploading'
        )

        sftp.put(
            filetoupload,
            temp_filename
        )

        try:
            sftp.posix_rename(
                temp_filename,
                filename
            )

        except Exception:
            # Fallback for SFTP-servere uten
            # posix-rename-extension.
            try:
                sftp.remove(
                    filename
                )

            except IOError:
                pass

            sftp.rename(
                temp_filename,
                filename
            )

        print(
            f"Uploaded {filetoupload} "
            f"to SFTP server at "
            f"{sftp_target_path}"
        )

    finally:
        if sftp is not None:
            sftp.close()

        if ssh is not None:
            ssh.close()


def trigger_event_logger(printer_data):
    """
    POST samme printer-snapshot til PHP-loggeren.
    Krever ingen ekstra Python-pakke.
    """

    credentials = load_credentials()

    logger_url = credentials.get(
        'logger_url',
        ''
    ).strip()

    logger_key = credentials.get(
        'logger_key',
        ''
    ).strip()

    if not logger_url or not logger_key:
        print(
            "Logger not configured; "
            "skipping event logging."
        )

        return

    payload = json.dumps(
        printer_data,
        ensure_ascii=False
    ).encode(
        'utf-8'
    )

    request = urllib.request.Request(
        logger_url,
        data=payload,
        method='POST',
        headers={
            'Content-Type':
                'application/json; charset=utf-8',
            'X-Logger-Key':
                logger_key,
            'User-Agent':
                'RicohReader/3.0'
        }
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=15
        ) as response:
            response_body = (
                response
                .read()
                .decode(
                    'utf-8',
                    errors='replace'
                )
            )

            print(
                f"Event logger HTTP "
                f"{response.status}: "
                f"{response_body}"
            )

    except urllib.error.HTTPError as e:
        body = (
            e.read()
            .decode(
                'utf-8',
                errors='replace'
            )
        )

        raise RuntimeError(
            f"HTTP {e.code}: {body}"
        ) from e

    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Could not reach logger: "
            f"{e.reason}"
        ) from e


# Global variables for the control panel
run_interval = 40
printers_file = 'Printers.pkl'


def control_panel():
    global run_interval
    global printers_file

    while True:
        print(
            "\nControl Panel:"
        )

        print(
            "1. Change run interval"
        )

        print(
            "2. Edit .pkl file"
        )

        print(
            "3. Exit"
        )

        choice = input(
            "Enter your choice: "
        )

        if choice == "1":
            try:
                new_interval = int(
                    input(
                        "New run interval "
                        "(seconds): "
                    )
                )

                if new_interval < 1:
                    print(
                        "Interval must be at "
                        "least 1 second."
                    )

                    continue

                run_interval = new_interval

                start_continuous_thread(
                    printers_file,
                    run_interval
                )

                print(
                    f"Run interval set to "
                    f"{run_interval} seconds."
                )

            except ValueError:
                print(
                    "Invalid interval. "
                    "Enter a whole number."
                )

        elif choice == "2":
            open_and_edit_pkl(
                printers_file
            )

        elif choice == "3":
            stop_event.set()

            if (
                continuous_thread is not None
                and
                continuous_thread.is_alive()
            ):
                continuous_thread.join(
                    timeout=10
                )

            print(
                "Exiting control panel..."
            )

            break

        else:
            print(
                "Invalid choice, please select "
                "1, 2, or 3."
            )


if __name__ == "__main__":
    start_continuous_thread(
        printers_file,
        run_interval
    )

    control_panel()
