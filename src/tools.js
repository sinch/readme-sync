const fs = require('fs');


function flatten (ary) {
    var ret = [];
    for(var i = 0; i < ary.length; i++) {
        if(Array.isArray(ary[i])) {
            ret = ret.concat(flatten(ary[i]));
        } else {
            ret.push(ary[i]);
        }
    }
    return ret;
}


async function fileExists(path) {
    return new Promise((resolve, reject) => {
        fs.access(path, fs.F_OK, (err) => {
            if (err) {
                reject(reject);
                return;
            }
            resolve();
        })
    });
}

/**
 * Asynchronously replaces all occurrences of content that match a regex in a source content string.
 * For every part of the content that matches the regex, the replacement function will be called with the
 * Regex match object. That function is expected to process the matched block and return a replacement value.
 * @param str the source string
 * @param regex the regex that will be used to find content
 * @param replacementFn The function that will be called to perform a specific replacement.
 * @returns {Promise<string>} A Promise of the resulting string where all matches have been replaced.
 */
async function asyncStringReplace(str, regex, replacementFn) {
    const substrs = [];
    let lastMatchPosition = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
        // push the part that wasn't a match
        substrs.push(str.slice(lastMatchPosition, match.index));

        // push the async replacement
        substrs.push(replacementFn(...match));

        // update pointer
        lastMatchPosition = regex.lastIndex;
    }
    // put the remainder of str that did not match
    substrs.push(str.slice(lastMatchPosition));

    // wait for async calls to finish and join them back into final string
    return (await Promise.all(substrs)).join('');
}


module.exports.flatten = flatten;
module.exports.fileExists = fileExists;
module.exports.asyncStringReplace = asyncStringReplace;