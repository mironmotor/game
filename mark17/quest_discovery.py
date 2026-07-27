"""
Quest Discovery via ADB
Finds Meta Quest devices on local network using Android Debug Bridge.
"""

import subprocess
import json
import re
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, asdict
import logging

logger = logging.getLogger(__name__)

@dataclass
class QuestDevice:
    """Discovered Meta Quest device."""
    serial: str
    host: str
    port: int
    state: str  # device, unauthorized, offline, no device
    product: str
    model: str
    device: str
    transport_id: str
    
    @property
    def is_connected(self) -> bool:
        return self.state == "device"
    
    @property
    def is_quest(self) -> bool:
        quest_names = ["quest", "meta", "rift", "holo"]
        full_name = f"{self.product} {self.model} {self.device}".lower()
        return any(name in full_name for name in quest_names)
    
    @property
    def display_name(self) -> str:
        return f"{self.product}/{self.model}" if self.product else self.serial


class QuestDiscovery:
    """ADB-based discovery for Meta Quest devices."""
    
    def __init__(self):
        self.devices: List[QuestDevice] = []
        self._adb_path = "adb"
    
    def _run_adb(self, args: List[str], timeout: int = 10) -> str:
        """Run ADB command and return output."""
        try:
            result = subprocess.run(
                [self._adb_path] + args,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            return result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            logger.warning("ADB command timed out")
            return ""
        except FileNotFoundError:
            logger.error("ADB not found. Install Android Platform Tools.")
            return ""
    
    def discover(self, timeout: float = 5.0) -> List[QuestDevice]:
        """
        Discover Quest devices via ADB.
        Uses `adb devices -l` for device listing.
        """
        self.devices = []
        
        output = self._run_adb(["devices", "-l"])
        
        for line in output.strip().split('\n'):
            line = line.strip()
            if not line or line.startswith('List') or line.startswith('*'):
                continue
            
            # Parse: serialno state product:model:device:transport_id
            parts = line.split()
            if len(parts) < 2:
                continue
            
            serial = parts[0]
            state = parts[1]
            
            # Parse extra info from -l output
            product = model = device = transport_id = ""
            
            if len(parts) > 2:
                for part in parts[2:]:
                    if ':' in part:
                        key, val = part.split(':', 1)
                        if key == 'product':
                            product = val
                        elif key == 'model':
                            model = val
                        elif key == 'device':
                            device = val
                        elif key == 'transport_id':
                            transport_id = val
            
            # Extract host:port from serial (for network devices)
            host, port = self._parse_serial(serial)
            
            dev = QuestDevice(
                serial=serial,
                host=host,
                port=port,
                state=state,
                product=product,
                model=model,
                device=device,
                transport_id=transport_id
            )
            
            self.devices.append(dev)
            logger.info(f"Found device: {dev.display_name} ({dev.state})")
        
        return self.devices
    
    def _parse_serial(self, serial: str) -> tuple:
        """Parse host:port from network device serial."""
        if ':' in serial and not serial.startswith('.'):
            # Network device: IP:port format
            parts = serial.rsplit(':', 1)
            if len(parts) == 2 and parts[1].isdigit():
                return parts[0], int(parts[1])
        return "", 5555  # Default ADB port
    
    def get_quests(self) -> List[QuestDevice]:
        """Get only Quest/Meta devices."""
        return [d for d in self.devices if d.is_quest]
    
    def get_connected(self) -> List[QuestDevice]:
        """Get only connected (authorized) devices."""
        return [d for d in self.devices if d.is_connected]
    
    def connect(self, host: str, port: int = 5555) -> bool:
        """Connect to a network device via ADB."""
        target = f"{host}:{port}"
        logger.info(f"Connecting to {target}...")
        output = self._run_adb(["connect", target])
        return "connected" in output.lower() or "already connected" in output.lower()
    
    def disconnect(self, host: str, port: int = 5555) -> bool:
        """Disconnect from a network device."""
        target = f"{host}:{port}"
        logger.info(f"Disconnecting from {target}...")
        output = self._run_adb(["disconnect", target])
        return "disconnected" in output.lower()
    
    def pair(self, host: str, port: int, code: str) -> bool:
        """Pair with a Quest device using pairing code."""
        target = f"{host}:{port}"
        logger.info(f"Pairing with {target}...")
        output = self._run_adb(["pair", target, code])
        return "successfully paired" in output.lower() or "paired" in output.lower()
    
    def to_dict(self) -> Dict[str, Any]:
        """Export discovery results as dict."""
        return {
            "devices": [asdict(d) for d in self.devices],
            "quests": [asdict(d) for d in self.get_quests()],
            "connected": [asdict(d) for d in self.get_connected()],
            "count": len(self.devices)
        }


# CLI entry point
if __name__ == "__main__":
    import argparse
    
    logging.basicConfig(level=logging.INFO)
    
    parser = argparse.ArgumentParser(description="Quest Discovery via ADB")
    parser.add_argument("--connect", metavar="HOST:PORT", help="Connect to device")
    parser.add_argument("--disconnect", metavar="HOST:PORT", help="Disconnect from device")
    parser.add_argument("--pair", nargs=3, metavar=("HOST", "PORT", "CODE"), help="Pair with device")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    discovery = QuestDiscovery()
    
    if args.connect:
        host, port = args.connect.rsplit(':', 1)
        success = discovery.connect(host, int(port))
        print(f"Connected: {success}")
    elif args.disconnect:
        host, port = args.disconnect.rsplit(':', 1)
        success = discovery.disconnect(host, int(port))
        print(f"Disconnected: {success}")
    elif args.pair:
        host, port, code = args.pair
        success = discovery.pair(host, int(port), code)
        print(f"Paired: {success}")
    else:
        devices = discovery.discover()
        if args.json:
            print(json.dumps(discovery.to_dict(), indent=2))
        else:
            print(f"Found {len(devices)} device(s):")
            for d in devices:
                print(f"  {d.display_name} ({d.serial}) - {d.state}")
