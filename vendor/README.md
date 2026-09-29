# Vendored libraries

These files are stored in the repo so the app can run without calling a CDN. Versions match the copies the page used to load from cdnjs.

| File | Library | Version | License |
| --- | --- | --- | --- |
| `chart.min.js` | [Chart.js](https://www.chartjs.org/) | 3.9.1 | MIT |
| `pdf.min.js` | [PDF.js](https://github.com/mozilla/pdf.js) | 3.11.174 | Apache-2.0 |
| `pdf.worker.min.js` | PDF.js worker | 3.11.174 | Apache-2.0 |

License notices are included in the file headers. Do not upgrade one PDF.js file without the other; the main script and worker must stay on the same version.
