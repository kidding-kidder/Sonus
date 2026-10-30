import struct

with open(r"src-tauri\target\release\sonus.exe", "rb") as f:
    dos_header = f.read(64)
    magic = dos_header[:2]
    e_lfanew = struct.unpack("<I", dos_header[60:64])[0]
    f.seek(e_lfanew)
    pe_sig = f.read(4)
    machine = struct.unpack("<H", f.read(2))[0]

print(f"DOS Header Magic: {magic.decode('ascii', errors='ignore')} (0x{magic.hex()})")
print(f"PE Signature: {pe_sig.decode('ascii', errors='ignore')} (0x{pe_sig.hex()})")
# 0x8664 is IMAGE_FILE_MACHINE_AMD64 (x64 PE)
is_pe64 = machine == 0x8664
print(f"Machine Type: 0x{machine:04x} (PE32+ x86_64: {is_pe64})")
assert magic == b"MZ"
assert pe_sig == b"PE\x00\x00"
assert is_pe64
print("VERIFICATION SUCCESS: Authentic native Windows PE32+ (AMD64) executable binary.")
