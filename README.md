# Economist → Ebook

For [annoying Amazon reasons](https://www.quora.com/Why-dont-Kindle-subscriptions-to-The-Economist-include-online-access), the Kindle edition of [The Economist](https://www.economist.com/) requires a separate subscription. This script allows Economist subscribers to get their weekly news on their e-readers (Kindle or otherwise). It assumes basic familiarity with [node.js](https://nodejs.org/en/) and command-line tools.

To use it, add your own subscription username and password to [`config.toml`](config.toml). Run `npm install` once, then `npm start` to download the current weekly edition.

If you have [Calibre](https://calibre-ebook.com/) installed, and its `ebook-convert` tool on your path, running this script will automatically convert the scraped HTML to epub, which you can add to your e-reader as usual.

If you don't have Calibre, you can use the output in `output/index.html` however you please. The command we use to convert HTML to epub is something like this:

```bash
ebook-convert output/index.html economist.epub --cover output/cover.png --page-breaks-before / --change-justification justify --authors "The Economist" --title "The Economist"
```

This script comes without warranty, of course. I'm using it regularly as of late 2020, but the Economist could change their website layout at any time, which would break the code.
