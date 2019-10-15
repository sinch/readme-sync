const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const request = require('request');
const { asyncStringReplace } = require("./tools");

const conversions = {
    code: codeBlockToMarkdown,
    image: imageToMarkdown,
    callout: calloutToMarkdown,
    html: htmlToMarkdown,
};

module.exports.widgetTypes = Object.keys(conversions);

/**
 * Replaces Readme-proprietary 'widgets' with standard Markdown code blocks.
 */
module.exports.markdownize = async (page, widgetTypes, options) => {
    const operations = widgetTypes.map(type => {
        return { widget: type, conversion: conversions[type] };
    });

    let content = page.content;
    for (const operation of operations) {
        content = await replaceWidgets(page, content, operation.widget, operation.conversion, options);
    }

    return content;
};


async function replaceWidgets(page, content, widget, conversionFn, options) {
    const findAllBlocks = new RegExp(`\\[block:${widget}\\]\\n(?<json>(.|[\\r\\n])*?)\\n\\[/block\\]`, 'gm');

    return asyncStringReplace(content, findAllBlocks, async (match, json) => {
        json = JSON.parse(json);

        const replacement = await conversionFn(json, page, options);

        if (options.verbose) {
            console.log(`In page [${page.ref}], the following ${widget} widget: \n`);
            console.log(chalk.red('\t' + match.replace(/\n/g, '\n\t')));
            console.log('\n');
            console.log(`${options.dryRun ? 'Would be' : 'Has been'} replaced by this Markdown: \n    `);
            console.log(chalk.green('\t' + replacement.replace(/\n/g, '\n\t')));
        }

        return replacement;
    });
}


function codeBlockToMarkdown(json) {
    var markdown = '';
    for (const block of json.codes) {
        if (block.name) {
            markdown += `\n**${block.name}**\n`;
        }
        markdown += '```' + block.language + '\n';
        markdown += block.code + '\n';
        markdown += '```\n\n';
    }
    return markdown;
}

function calloutToMarkdown(json) {
    // body must be pre-processed
    const body = json.body
        .replace(/\n/g, '\n> ');

    var type;
    switch (json.type) {
        case 'warning': type = 'WARNING: '; break;
        default:
            type = '';
    }

    return `
> **${type}${json.title}**    
>
> ${body}
`;
}

function htmlToMarkdown(json) {
    return `
<div class="magic-block-html">
    ${json.html.replace(/\n/g, '\n   ')}
</div>
`;
}

async function downloadImage(url, relativeToPage, options) {
    const remoteUrl = new URL(url);

    if (!options.download) {
        return url;
    }

    if (remoteUrl.host === options.downloadFrom) {
        const filename = path.basename(remoteUrl.pathname);
        const pageRelativePath = path.join('images', filename);
        const localPath = path.join(options.dir, relativeToPage.directory, pageRelativePath);

        if (options.dryRun) {
            console.log(chalk.cyan(`DRY RUN: Would download remote image [${url}] to local path [${localPath}]`));
        } else {
            await new Promise((resolve, reject) => {
                fs.mkdirSync(path.dirname(localPath), {recursive: true});

                request(url)
                    .on('response', () => {
                        console.log(chalk.green(`Downloaded remote image [${url}] to local path [${localPath}]`));
                        resolve();
                    })
                    .on('error', reject)
                    .pipe(fs.createWriteStream(localPath))
            });
        }
        return pageRelativePath;
    }
}

async function imageToMarkdown(json, page, options) {
    var markdown = '';
    for (const details of json.images) {
        let [href, label] = details.image;

        href = await downloadImage(href, page, options);
        markdown += `![${label}](${href})`;
        if (details.caption) {
            markdown += `\n${details.caption}`;
        }
        markdown += `\n`;
    }
    return markdown;
}
