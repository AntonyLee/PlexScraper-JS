var program = require("commander"),
    fs = require("fs-extra"),
    path = require("path"),
    format = require("string-format"),
    streamToPromise = require("stream-to-promise"),
    EventProxy = require("eventproxy")


var regex_const = require("./const"),
    spider = require("./spider");

program.version("0.0.1")
        .option('-d, --dir [value]', 'Set folder to traverse', '')
        .option('-m, --maxdepth <n>', 'Set search depth', parseInt)
        .option('-r, --moveFile', "Move file to new folder", false)
        .parse(process.argv);

const ROOT_DIR = program.dir;
const SEARCH_DEPTH = program.maxdepth;
const MOVE_TO_DIR_ROOT = "/Users/abusimbely/Documents/DST_DIR/";

var isVideoFile = function (file) {
    let ext = path.extname(file);
    if (ext == ".avi"
        || ext == ".mp4"
        || ext == ".rmvb"
        || ext == ".rm"
        || ext == ".mkv") {
        return true;
    }
    else
        return false;
}

var isCensoredVideo = function(file) {
    let result = false;
    if (file.search(regex_const.REGEX_IDTAG) >= 0) {
        return true;
    }
    // console.log("   isCensoredVideo: " + result);
    return result;
}

let videoFiles = [];
let foldersToTraverse = [];

var traverseDir = function(dir, depth) {
    if (!dir) {
        console.log("Invalid dir: " + dir);
        return
    }

    if (!depth) {
        depth = 0;
    }

    if (depth >= SEARCH_DEPTH) {
        return ;
    }

    console.log("");
    console.log(">>> traversing dir %s, depth %j ==========", dir, depth);

    if (!fs.lstatSync(dir).isDirectory())
        return ;

    files = fs.readdirSync(dir);
    files.forEach((file) => {
        let absPath = path.join(dir, file);
        // console.log("path: %s", absPath);

        let stat = fs.lstatSync(absPath);
        if (stat.isDirectory()) {
            // console.log("New directory located: " + absPath);
            foldersToTraverse.push({path: absPath, depth: depth + 1});
        } else if (isVideoFile(file) && isCensoredVideo(file)) {
            console.log("Video file located: " + absPath);
            videoFiles.push(absPath);
        }


        let nextDir = foldersToTraverse.pop();
        if (nextDir)
            traverseDir(nextDir.path, nextDir.depth);
    })
}

//递归创建目录 同步方法
function mkdirsSync(dirname) {
    console.log(dirname);
    if (fs.existsSync(dirname)) {
        return true;
    } else {
        if (mkdirsSync(path.dirname(dirname))) {
            fs.mkdirSync(dirname);
            return true;
        }
    }
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
    console.log("Move file to : " + dstFullName);
    mkdirsSync(dstPath);
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

    videos.forEach((video) => {
        console.log(">>> Start Scrapping Video <<<");
        console.log(">>> %s", video);

        let idtag = video.match(regex_const.REGEX_IDTAG);
        console.log(idtag);
        if (idtag instanceof Array) {
            idtag = idtag[idtag.length-1];
        }

        // console.log(idtag);
        spider.scrape(idtag, path.dirname(video))
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
                console.log(err);
                ep.emit("video scrapped", {});
            })
    })
}

var scrapeAllVideos = function (videos) {

    console.log("========= =========== ========");
    console.log("scrapeAllVideos")

    if (videos.length <= 0) {
        console.log("No videos to scrape");
        return ;
    }

    const VIDEO_COUNT_A_BATCH = 2;
    let batchCount = Math.ceil(videos.length / VIDEO_COUNT_A_BATCH);

    console.log("DEBUG: VIDEO BATCHES, count = %d", batchCount);
    let batches = [];
    for (let i = 0; i < batchCount; ++i) {
        let batch = videos.slice(0, VIDEO_COUNT_A_BATCH);
        console.log("batch: %s", batch);
        batches.push(batch);
        videos.splice(0, VIDEO_COUNT_A_BATCH);
    }

    let ep = new EventProxy();
    let currBatch = 0;

    ep.after("batch scrapped", 1, function (results) {
        console.log("batch scrappped");
        console.log("");
        console.log("");
        currBatch += 1;

        scrapeABatch(batches[currBatch], ep);
    })

    scrapeABatch(batches[currBatch], ep);
}


traverseDir(ROOT_DIR, SEARCH_DEPTH);
scrapeAllVideos(videoFiles);
