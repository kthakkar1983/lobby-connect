#!/usr/bin/env python3
"""Generate a small, valid sample playbook PDF (correct xref offsets)."""
import sys

lines = [
    ("/F1 28 Tf", "(The Sample Hotel) Tj"),
    ("/F1 14 Tf", "(After-Hours Front Desk Playbook) Tj"),
]
# Build a text content stream with several sections.
content = b"BT\n/F1 28 Tf\n72 720 Td\n(The Sample Hotel) Tj\n"
content += b"/F1 13 Tf\n0 -26 Td\n(After-Hours Front Desk Playbook) Tj\n"
sections = [
    ("GREETING", "Good evening, thank you for calling the front desk. How may I help you?"),
    ("CHECK-IN", "Verify the reservation name and a photo ID. Issue the room key at kiosk slot 2."),
    ("COMMON REQUESTS", "Extra towels, late checkout, parking. Wi-Fi: SampleHotel-Guest / welcome123."),
    ("EMERGENCY", "For any medical or fire situation, press the Emergency button to alert the manager."),
]
for head, body in sections:
    content += b"/F1 14 Tf\n0 -40 Td\n(" + head.encode() + b") Tj\n"
    content += b"/F1 11 Tf\n0 -18 Td\n(" + body.encode() + b") Tj\n"
content += b"ET"

obj1 = b"<< /Type /Catalog /Pages 2 0 R >>"
obj2 = b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"
obj3 = (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>")
obj4 = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
obj5 = b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream"

objs = [obj1, obj2, obj3, obj4, obj5]

out = bytearray()
out += b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
offsets = []
for i, body in enumerate(objs, start=1):
    offsets.append(len(out))
    out += str(i).encode() + b" 0 obj\n" + body + b"\nendobj\n"

xref_pos = len(out)
n = len(objs) + 1
out += b"xref\n0 " + str(n).encode() + b"\n0000000000 65535 f \n"
for off in offsets:
    out += ("%010d 00000 n \n" % off).encode()
out += (b"trailer\n<< /Size " + str(n).encode() + b" /Root 1 0 R >>\n"
        b"startxref\n" + str(xref_pos).encode() + b"\n%%EOF\n")

with open(sys.argv[1], "wb") as f:
    f.write(out)
print(f"wrote {len(out)} bytes to {sys.argv[1]}")
