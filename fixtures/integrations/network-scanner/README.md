# network-scanner fixture

`scan_report.txt` is **hand-authored** in the exact text format that
[`cleissonbarbosa/network-scanner`](https://github.com/cleissonbarbosa/network-scanner)
writes to `scan_report.txt` (see `app/Main.hs`, `app/Scanner.hs` and
`app/OSFingerprint.hs` in that repository):

```
Scan report generated at: <UTC timestamp>

Port <n> is open (<service>)
No connection to port <n>
...

OS Fingerprint based on TTL (<ttl>): <guess>
```

It describes a fictional `127.0.0.1` and was not captured from a real host.
AEGIS only ever _parses_ this file. It never runs the scanner and never opens
a socket to scan anything.
