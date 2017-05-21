
var C = require("./const")

var fs = require("fs-extra"),
    path = require("path")

//递归创建目录 同步方法
function mkdirsSync(dirname) {
    logger.log(dirname);
    if (fs.existsSync(dirname)) {
        return true;
    } else {
        if (mkdirsSync(path.dirname(dirname))) {
            fs.mkdirSync(dirname);
            return true;
        }
    }
}

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
    if (file.search(C.REGEX_IDTAG) >= 0) {
        return true;
    }
    return result;
}

var getIdTagFromFileName = function (fileName) {

    let baseName = path.basename(fileName)
    let idTag = baseName.match(C.REGEX_IDTAG);

    return idTag;
}

var getNfoFilePath = function (idTag) {
    return C.WORKING_DIR + idTag + ".nfo";
}

var getFanartFilePath = function (idTag) {
    return C.WORKING_DIR + idTag + "-fanart.jpg";
}

var getPosterFilePath = function (idTag) {
    return C.WORKING_DIR + idTag + "-poster.jpg";
}

module.exports = {
    mkdir: mkdirsSync,
    isVideoFile: isVideoFile,
    isCensoredVideo: isCensoredVideo,
    getIdTagFromFileName: getIdTagFromFileName,
    getNfoFilePath: getNfoFilePath,
    getFanartFilePath: getFanartFilePath,
    getPosterFilePath: getPosterFilePath
}
