
var regex_const = require("./const")

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
    if (file.search(regex_const.REGEX_IDTAG) >= 0) {
        return true;
    }
    // logger.log("   isCensoredVideo: " + result);
    return result;
}

module.exports = {
    mkdir: mkdirsSync,
    isVideoFile: isVideoFile,
    isCensoredVideo: isCensoredVideo

}
