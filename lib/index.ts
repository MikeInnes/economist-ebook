import {Builder, By, Key, WebDriver, WebElement} from 'selenium-webdriver';
import toml from 'toml';
import fs from 'fs/promises';
import child_process from 'child_process';
import path from 'path';

require('chromedriver');

async function sleep(n: number) {
    return new Promise(resolve => setTimeout(resolve, n*1000));
}

function exec(cmd: string, args: string[], options: object | undefined = undefined) {
    return new Promise((resolve, error) => {
        let proc = child_process.spawn(cmd, args, options);
        proc.stdout.on('data', data => process.stdout.write(data));
        proc.stderr.on('data', data => process.stderr.write(data));
        proc.on('exit', code => {
            if (code == 0) resolve(code);
            else error(code);
        });
    });
}

function waitForLoad(driver: WebDriver) {
    return driver.wait(async () => {
        let ready = await driver.executeScript('return document.readyState');
        return ready === 'complete';
    });
}

function waitForLogin(driver: WebDriver) {
    return driver.wait(async () => {
        let ready = await driver.executeScript('return document.readyState');
        let url = await driver.getCurrentUrl();
        return ready === 'complete' && !url.match('authenticate.economist.com');
    });
}

async function load(driver: WebDriver, url: string) {
    await driver.get(url);
    await waitForLoad(driver);
}

async function exists(driver: WebDriver | WebElement, query: string) {
    return (await driver.findElements(By.css(query))).length > 0;
}

function select(driver: WebDriver | WebElement, query: string) {
    return driver.findElement(By.css(query));
}

function selectAll(driver: WebDriver | WebElement, query: string) {
    return driver.findElements(By.css(query));
}

async function elementText(driver: WebDriver | WebElement, query: string) {
    if (await exists(driver, query)) {
        return (await select(driver, query)).getText()
    } else {
        return '';
    }
}

// Work around server errors
// The page appears to load normally, and then get replaced by an error page by JS,
// so we have to wait.
async function loadArticle(driver: WebDriver, url: string) {
    await load(driver, url);
    await sleep(1);
    if (!(await exists(driver, '.layout-article-body'))) {
        await loadArticle(driver, url);
    }
}

async function imageBase64(driver: WebDriver, src: string) {
    let dataurl: string = await driver.executeScript(`
        function toDataURL(src, callback, outputFormat) {
            var img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = function() {
            var canvas = document.createElement('CANVAS');
            var ctx = canvas.getContext('2d');
            var dataURL;
            canvas.height = this.naturalHeight;
            canvas.width = this.naturalWidth;
            ctx.drawImage(this, 0, 0);
            dataURL = canvas.toDataURL(outputFormat);
            callback(dataURL);
            };
            img.src = src;
            if (img.complete || img.complete === undefined) {
                img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
                img.src = src;
            }
        }

        return new Promise(resolve => toDataURL('${src}', resolve));
    `);
    return dataurl.match(/base64,(.*)$/)![1];
}

async function downloadImageURL(driver: WebDriver, url: string,
                                file: string | null = null) {
    let base64 = await imageBase64(driver, url);
    if (file === null) {
        file = 'images/' + path.basename(url);
    }
    file = __dirname + '/../output/' + file;
    file = file.replace(/\.jpg$/, '.png');
    await fs.writeFile(file, base64, {encoding: 'base64'});
}

async function downloadImage(driver: WebDriver, query: string, file: string | null = null) {
    let url = await select(driver, query).getAttribute('src');
    await downloadImageURL(driver, url, file);
    return path.basename(url).replace(/\.jpg$/, '.png');
}

async function article(dr: WebDriver, url: string) {
    await loadArticle(dr, url);
    let headline = await elementText(dr, '.article__headline');
    let subheadline = await elementText(dr, '.article__subheadline');
    let description = await elementText(dr, '.article__description');
    let image;
    try {
        image = await downloadImage(dr, '.article__lead-image img');
    } catch (e) {}
    let rm = '.advert, .article__aside, .layout-article-links, .article__footnote, meta, iframe, .article-recirculation-aside';
    await dr.executeScript(`
        document.querySelectorAll('.layout-article-body ${rm}').forEach(x => x.parentElement.removeChild(x));
    `);
    let imgs: string[] = await dr.executeScript(`
        let imgs = [];
        document.querySelectorAll('.layout-article-body img').forEach(img => {
            imgs.push(img.src);
            img.src = 'images/' + img.src.match(/\\/([^\/]+)$/)[1];
            img.srcset = "";
            img.sizes = "";
        });
        return imgs;
    `);
    await Promise.all(imgs.map(x => downloadImageURL(dr, x)));
    let content = await select(dr, '.layout-article-body').getAttribute('outerHTML');
    return {headline, subheadline, description, image, content};
}

async function sections(dr: WebDriver) {
    let ss = await selectAll(dr, 'main section');
    return Promise.all(ss.map(async s => ({
        title: await select(s, 'h2.ds-section-headline').getText(),
        articles: await Promise.all((await selectAll(s, 'a.headline-link, a.weekly-edition-wtw__link')).map(a => a.getAttribute('href')))
    })));
}

async function writeHeader(file: fs.FileHandle) {
    await file.write(`<html>
<head>
    <meta http-equiv="Content-Type" content="text/html;charset=utf-8" />
    <link href="style.css" rel="stylesheet" type="text/css" />
    <title>The Economist</title>
</head>
<body>\n`);
}

async function createHtml(dr: WebDriver, edition: string) {
    await load(dr, edition);
    let title = await select(dr, '.weekly-edition-header__headline').getText();
    await downloadImage(dr, '.weekly-edition-header__image img', 'cover.png');
    let secs = await sections(dr);

    let out = await fs.open(__dirname + '/../output/index.html', 'w');
    await writeHeader(out);
    for (let sec of secs) {
        await out.write('<div class="pagebreak"></div>');
        await out.write(`<div class="section">${sec.title}</div>\n`);
        for await (let url of sec.articles) {
            let art = await article(dr, url);
            await out.write('<div class="pagebreak"></div>');
            await out.write(`<div>${art.subheadline}</div>\n`);
            await out.write(`<h1>${art.headline}</h1>\n`);
            await out.write(`<strong>${art.description}</strong>\n`);
            if (art.image !== undefined) {
                await out.write(`<img src="images/${art.image}" />\n`);
            }
            await out.write(art.content);
            await out.write('\n');
        }
    }
    await out.write(`</body>\n</html>\n`);
    await out.close();
    return title;
}

async function main() {
    let {username, password} = toml.parse(await fs.readFile('config.toml', 'utf8'));

    // Load content

    let dr = await new Builder().forBrowser('chrome').build();

    await load(dr, 'https://economist.com/');
    try {
        let accept = await select(dr, '#_evidon-banner-acceptbutton');
        await accept.click();
    } catch (e) {}
    await select(dr, '.ds-masthead-nav-beta__item--log-in').click();
    await waitForLoad(dr);
    await select(dr, 'input[type=email]').sendKeys(username);
    await select(dr, 'input[type=password]').sendKeys(password, Key.RETURN);
    await waitForLogin(dr);

    let title = await createHtml(dr, 'https://www.economist.com/weeklyedition/');

    dr.close();

    // Convert to epub, if possible

    try {
        await exec('which', ['ebook-convert']);
    } catch (e) {
        console.error("Couldn't find ebook-convert, creating HTML only.");
        process.exit(0);
    }

    try {
        await exec('ebook-convert',
                   ['output/index.html', `${title.replace(': ', ' – ')}.epub`,
                    '--cover', 'output/cover.png',
                    '--page-breaks-before', '/',
                    '--change-justification', 'justify',
                    '--authors', 'The Economist',
                    '--title', title]);
    } catch (e) {
        console.error('ebook-convert failed.');
    }
}

main();
