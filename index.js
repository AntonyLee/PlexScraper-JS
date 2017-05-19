var program = require("commander"),
    fs = require("fs-extra"),
    path = require("path"),
    format = require("string-format"),
    streamToPromise = require("stream-to-promise"),
    EventProxy = require("eventproxy"),
    logger = require("tracer").colorConsole();

var regex_const = require("./const"),
    spider = require("./spider"),
    utility = require("./utility"),
    env = require("./const")

program.version("0.0.1")
        .option('-d, --dir [value]', 'Set folder to traverse', '')
        .option('-m, --maxdepth <n>', 'Set search depth', parseInt)
        .option('-r, --moveFile', "Move file to new folder", false)
        .parse(process.argv);

const ROOT_DIR = program.dir;
const SEARCH_DEPTH = program.maxdepth;
const MOVE_TO_DIR_ROOT = "/Users/abusimbely/Documents/DST_DIR/";

let videoFiles = [];
let foldersToTraverse = [];

var traverseDir = function(dir, depth) {
    logger.log("Traversing dir %s, depth %j", dir, depth);

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


    if (!fs.lstatSync(dir).isDirectory())
        return ;

    files = fs.readdirSync(dir);
    files.forEach((file) => {
        let absPath = path.join(dir, file);
        // logger.log("path: %s", absPath);

        let stat = fs.lstatSync(absPath);
        if (stat.isDirectory()) {
            // logger.log("New directory located: " + absPath);
            foldersToTraverse.push({path: absPath, depth: depth + 1});
        } else if (utility.isVideoFile(file) && utility.isCensoredVideo(file)) {
            logger.log("Video file located: " + absPath);
            videoFiles.push(absPath);
        }


        let nextDir = foldersToTraverse.pop();
        if (nextDir)
            traverseDir(nextDir.path, nextDir.depth);
    })

    logger.log("Traversing finished.");
}


var moveVideoFile = function(videoFile, metadata) {
    let actorsStr = "";

    metadata.actors.forEach((actor) => {
        actorsStr += actor.actorName;
    });

    let baseName = path.basename(videoFile);
    let extName = path.extname(videoFile);

    let titleName = format("({0})({1}){2}", metadata.id, metadata.studio, metadata.title);

    let dstPath = path.join(MOVE_TO_DIR_ROOT, actorsStr, titleName);
    let dstFullName = path.join(dstPath, titleName+extName);
    logger.log("Move file to : " + dstFullName);
    utility.mkdir(dstPath);
    return fs.rename(videoFile, dstFullName)
        .then((result) => {
            let nfoFileName = path.join(dstPath, titleName+".nfo");
            let writeStream = fs.createWriteStream(nfoFileName);
            writeStream.write(metadata.toXMLString());
            return streamToPromise(writeStream).then(() => {return metadata});
        })
        .then(function (result) {
            return metadata;
        })
}

var scrapeABatch = function (videos, ep) {

    ep.after("video scrapped", videos.length, function (metadatas) {
        ep.emit("batch scrapped", {});
    })

    let promises = [];

    videos.forEach((video) => {

        let basename = path.basename(video);
        let idtag = video.match(regex_const.REGEX_IDTAG);

        let promise = spider.scrapeFull(idtag)
            .then((metadata) => {
                if (program.moveFile) {
                    return moveVideoFile(video, metadata);
                } else {
                    return metadata;
                }
            })
            .then((metadata) => {
                ep.emit("video scrapped", metadata);
            })
            .catch((err) => {
                logger.log(err);
                ep.emit("video scrapped", {});
            })

        promises.push(promise);
    })
}

var scrapeAllVideos = function (videos) {

    logger.log("scrapeAllVideos")

    if (videos.length <= 0) {
        logger.log("No videos to scrape");
        return ;
    }

    const VIDEO_COUNT_A_BATCH = 1;
    let batchCount = Math.ceil(videos.length / VIDEO_COUNT_A_BATCH);

    logger.debug("VIDEO BATCHES, count = %d", batchCount);
    let batches = [];
    for (let i = 0; i < batchCount; ++i) {
        let batch = videos.slice(0, VIDEO_COUNT_A_BATCH);
        logger.log("batch: %s", batch);
        batches.push(batch);
        videos.splice(0, VIDEO_COUNT_A_BATCH);
    }

    let ep = new EventProxy();
    let currBatch = 0;

    ep.on("batch scrapped", function (result) {
        logger.log("batch scrappped");

        currBatch += 1;

        if (currBatch < batchCount) {
            scrapeABatch(batches[currBatch], ep);
        }
    })

    scrapeABatch(batches[currBatch], ep);
}


var prepareEnv = function() {
    if (!fs.existsSync(env.WORKING_DIR)) {
        utility.mkdir(env.WORKING_DIR);
    }
}

var main = function () {
    prepareEnv();
    traverseDir(ROOT_DIR);
    scrapeAllVideos(videoFiles);
}

main();

