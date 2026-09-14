"""
SFTP-opplaster for Ricoh SNMP Collector.

Laster opp `printer_data.json` atomisk via et midlertidig filnavn
og omdøping, slik at webserver/frontend aldri leser en halv fil.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from .config import SftpConfig

logger = logging.getLogger("ricoh_collector.sftp")


class SftpUploader:
    """Håndterer sikker filoverføring via SFTP til webserveren."""

    def __init__(self, config: SftpConfig):
        self.config = config

    def upload_file(self, local_path: str | Path) -> bool:
        """
        Laster opp en lokal fil til konfigurert SFTP-sti atomisk.
        """
        if not self.config.is_configured:
            logger.debug("SFTP er ikke konfigurert; hopper over opplasting.")
            return False

        try:
            import paramiko
        except ImportError:
            logger.error("Pakken 'paramiko' mangler. Kjør: pip install paramiko")
            return False

        p = Path(local_path)
        if not p.is_file():
            logger.error(f"Finner ikke lokal fil for opplasting: {p}")
            return False

        filename = p.name
        temp_filename = f"{filename}.uploading"

        ssh: Optional[paramiko.SSHClient] = None
        sftp: Optional[paramiko.SFTPClient] = None

        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            logger.debug(f"Kobler til SFTP {self.config.user}@{self.config.host}:{self.config.port}...")
            ssh.connect(
                self.config.host,
                port=self.config.port,
                username=self.config.user,
                password=self.config.password,
                timeout=15,
            )

            sftp = ssh.open_sftp()
            sftp.chdir(self.config.target_path)

            # 1. Last opp til midlertidig fil
            sftp.put(str(p), temp_filename)

            # 2. Atomisk omdøping
            try:
                sftp.posix_rename(temp_filename, filename)
            except Exception:
                # Fallback for SFTP-servere uten posix-rename
                try:
                    sftp.remove(filename)
                except IOError:
                    pass
                sftp.rename(temp_filename, filename)

            logger.info(f"Vellykket SFTP-opplasting: {filename} -> {self.config.target_path}")
            return True

        except Exception as e:
            logger.error(f"SFTP-opplasting feilet mot {self.config.host}: {e}")
            return False

        finally:
            if sftp is not None:
                try:
                    sftp.close()
                except Exception:
                    pass
            if ssh is not None:
                try:
                    ssh.close()
                except Exception:
                    pass

    def test_connection(self) -> tuple[bool, str]:
        """Tester tilkobling og skrivetilgang til SFTP-serveren."""
        if not self.config.is_configured:
            return False, "SFTP er ikke konfigurert i config.json / miljøvariabler."

        try:
            import paramiko
        except ImportError:
            return False, "Python-pakken 'paramiko' er ikke installert."

        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                self.config.host,
                port=self.config.port,
                username=self.config.user,
                password=self.config.password,
                timeout=10,
            )
            sftp = ssh.open_sftp()
            sftp.chdir(self.config.target_path)

            # Test skrivetilgang med en mikroskopisk testfil
            test_file = ".ricoh_sftp_test"
            with sftp.open(test_file, "w") as f:
                f.write("test ok")
            sftp.remove(test_file)

            sftp.close()
            ssh.close()
            return True, f"Tilkobling til {self.config.host}:{self.config.port} ({self.config.target_path}) fungerer utmerket!"
        except Exception as e:
            return False, f"SFTP-test feilet: {type(e).__name__} - {e}"
