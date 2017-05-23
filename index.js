var program = require("commander"),
    fs = require("fs-extra"),
    path = require("path"),
    format = require("string-format")

var spider = require("./spider"),
    utility = require("./utility"),
    C = require("./const")

var logger = utility.requireLogger();

program.version("0.0.1")
        .option('-d, --dir [value]', 'Set folder to traverse', '')
        .option('-m, --maxdepth <n>', 'Set search depth', parseInt)
        .option('-r, --moveFile', "Move file to new folder", false)
        .option('--refresh-cache', "Abandon cached file", false)
        .parse(process.argv);

const ROOT_DIR = program.dir;
const SEARCH_DEPTH = program.maxdepth;

let videoFiles = [];
let foldersToTraverse = [];

var traverseDir = function(dir, depth) {
    logger.debug("Traversing dir %s, depth %j", dir, depth);

    if (!dir) {
        logger.log("Invalid dir: " + dir);
        return
    }

    if (!depth) {
        depth = 0;
    }

    if (depth >= SEARCH_DEPTH) {
        logger.log("Current depth %d is larger than MAX_DEPTH %d", depth, SEARCH_DEPTH);
        return ;
    }

    let state = fs.lstatSync(dir);
    if (!state.isDirectory()) {
        if (state.isFile()) {
            videoFiles.push(dir);
            return ;
        }
    }

    files = fs.readdirSync(dir);
    files.forEach((file) => {
        let absPath = path.join(dir, file);

        let stat = fs.lstatSync(absPath);
        if (stat.isDirectory()) {
            foldersToTraverse.push({path: absPath, depth: depth + 1});
        } else if (utility.isVideoFile(file) && utility.isCensoredVideo(file)) {
            logger.log("Video file located: " + absPath);
            videoFiles.push(absPath);
        }

        let nextDir = foldersToTraverse.pop();
        if (nextDir)
            traverseDir(nextDir.path, nextDir.depth);
    })
}

var moveVideoFileToUndefineFolder = function(videoFile) {
    let dstPath = path.join(C.MOVE_TO_DIR_ROOT, "undefine");
    if (!(fs.existsSync(dstPath))) {
        utility.mkdir(dstPath);
    }

    let videoFileBaseName = path.basename(videoFile);

    let renameArr = [];
    renameArr.push({
        from: videoFile,
        to: path.join(dstPath, videoFileBaseName)
    })

    let promises = [];
    renameArr.forEach((rename) => {
        logger.log(rename);
        promises.push(fs.rename(rename.from, rename.to));
    })

    return Promise.all(promises).then(()=> {return {};})
        .catch(err => {
            logger.error(err);
            throw err;
        })
}

var moveVideoFile = function(videoFile, metadata) {
    let actorsStr = "";

    metadata.actors.forEach((actor, index, array) => {
        if (index == array.length - 1) {
            actorsStr += actor.actorName;
        } else {
            actorsStr += actor.actorName + ", ";
        }
    });

    if (actorsStr === "")
        actorsStr = "素人";

    let idTag = metadata.id;

    let titleName = format("({0})({1}){2}", metadata.id, metadata.studio, metadata.title);
    titleName = utility.normalizePath(titleName);

    let dstPath = path.join(C.MOVE_TO_DIR_ROOT, actorsStr, titleName);

    if (!fs.existsSync(dstPath))
        utility.mkdir(dstPath);

    let videoFileBaseName = path.basename(videoFile);
    let videoFileExtName = path.extname(videoFile);

    // collect file need to rename
    let renameArr = [];
    // 1. video file
    renameArr.push({
        from: videoFile,
        to: path.join(dstPath, idTag + videoFileExtName)
    })

    // 2. nfo file
    renameArr.push({
        from: utility.getNfoFilePath(idTag),
        to: path.join(dstPath, idTag + ".nfo")
    })


    // 3. fanart files
    renameArr.push({
        from: utility.getFanartFilePath(metadata.id),
        to: path.join(dstPath, idTag + "-fanart.jpg")
    });
    renameArr.push({
        from: utility.getPosterFilePath(metadata.id),
        to: path.join(dstPath, idTag + "-poster.jpg")
    });


    let promises = [];
    renameArr.forEach((rename) => {
        logger.log(rename);
        // promises.push(Promise.resolve(0));
        promises.push(fs.rename(rename.from, rename.to));
    })

    return Promise.all(promises).then(()=> {return metadata;})
        .catch(err => {
            logger.error(err);
            throw err;
        })
}

function scrapeABatch(videos) {

    let promises = [];

    videos.forEach((video) => {

        logger.debug("video = %s", video)

        let idTag = utility.getIdTagFromFileName(video.toString());

        let promise = spider.scrape(idTag, program.refreshCache)
            .then((metadata) => {
                if (program.moveFile) {
                    return moveVideoFile(video, metadata);
                } else {
                    return metadata;
                }
            })
            .catch(err => {
                if (err.message === C.NO_SEARCH_RESULT) {
                    logger.warn("No Search Result, move to undefine folder");

                    return moveVideoFileToUndefineFolder(video);
                }
            })
            .then(() => {
                logger.log("Done scrapping and move for %s", idTag);
            })
            .catch((err) => {           // end of the promise chain for scrapping one single movie, need handle error here finally
                logger.error(err);
            })

        promises.push(promise);
    })

    return Promise.all(promises);
}

var scrapeAllVideos = function (videos) {

    logger.log("Start scrapping all videos, count: %d", videos.length);

    if (videos.length <= 0) {
        logger.warn("No videos to scrape");
        return ;
    }

    const VIDEO_COUNT_A_BATCH = 1;
    let batchCount = Math.ceil(videos.length / VIDEO_COUNT_A_BATCH);

    logger.debug("VIDEO BATCHES, count = %d", batchCount);
    let batches = [];
    for (let i = 0; i < batchCount; ++i) {
        let batch = videos.slice(0, VIDEO_COUNT_A_BATCH);
        logger.debug("batch: %s", batch);
        batches.push(batch);
        videos.splice(0, VIDEO_COUNT_A_BATCH);
    }

    function asyncScrape(j) { // ATTENTION: this is a closure
        return function () {
            return scrapeABatch(batches[j]);
        }
    }

    let funcArr = [];
    for (let i = 0; i < batchCount; ++i) {
        funcArr.push(asyncScrape(i));
    }

    let masters = [];
    masters[0] = funcArr[0]();
    for (let i = 1; i < funcArr.length; ++i) {
        masters[i] = masters[i-1].then(funcArr[i]);
    }
}


var prepareEnv = function() {
    if (!fs.existsSync(C.WORKING_DIR)) {
        utility.mkdir(C.WORKING_DIR);
    }
}

var main = function () {
    prepareEnv();
    traverseDir(ROOT_DIR);
    logger.trace(videoFiles);
    scrapeAllVideos(videoFiles);
}

main();

