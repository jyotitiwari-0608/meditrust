CDSCO NSQ monthly alert PDFs go here.
Place files named like nsq-YYYY-MM.pdf in this directory.

The ingestion script (server/ingestion/cdscoNsq.js) reads PDFs with pdf-parse.
Real PDFs must be downloaded from the CDSCO website (free). This folder is empty
in the repo because source PDFs are large and should not be committed.

If no PDFs are present, cdscoNsq.js logs "No CDSCO PDFs found" and exits cleanly.

Per AGENTS.md rule 4: never attach a synthetic signal to a real company name.
Only use real CDSCO data files here; do not fabricate PDF contents.
