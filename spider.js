/**
 * Created by abusimbely on 2017/5/8.
 */

var fs = require("fs-extra"),
    cheerio = require("cheerio"),
    request = require("superagent"),
    retry = require("bluebird-retry"),
    gm = require("gm"),
    format = require('string-format'),
    path = require("path")

var Scrapper = require("./scrapper.js");
    utility = require("./utility"),
    C = require("./const")

var logger = utility.requireLogger();

function Spider(options) {
    options = this.options = options || {};

    this.movieIdTag = options.movieIdTag;
    this.refreshCache = options.refreshCache;
}

Spider.prototype = {
    constructor: Spider,

    getSearchUrl() {
        return "https://avio.pw/cn/search/" + this.movieIdTag;
    },

    writeToFile: function (htmlText, fileToWrite) {

        return fs.writeFile(fileToWrite, htmlText);
    },

    getMovieUrlFromSearchResult: function (searchResult) {

        var self = this;

        var $ = cheerio.load(searchResult);
        var movieUrl = $(".movie-box").attr("href");

        logger.info("Movie Url = " + movieUrl);

        return movieUrl;
    },


    crawlPage: function(url) {

        return retry(function () {
            logger.log("Crawling page: " + url);

            return request.get(url)
                .timeout({
                    response: 10000,
                    deadline: 20000,
                })
                .then(function (response) {
                    let result = response.res;
                    return result;
                })
                .catch(function (error) {
                    logger.error(error);
                    throw error;
                })
        }, {
            max_tries: 5,
            interval: 5000,
            backoff: 1,
        })
    },

    crawlImage: function(url, dst) {

        return retry(function () {
            logger.log("Start downloading image url = ", url);

            var httpStream = request.get(url)
                .timeout({
                    response: 20000,
                    deadline: 30000,
                })
                .on("response", (response) => {
                    let totalLength = 0;
                    logger.log("=== response=== ", response.res.statusCode);
                    response.on("data", function (chunk) {
                            totalLength += chunk.length;
                            logger.log("downloading... %s", totalLength);
                        })
                })

            let writeStream = fs.createWriteStream(dst);
            httpStream.pipe(writeStream);

            return new Promise((resolve, reject) => {
                writeStream.on("close", resolve);
            })

        }, {
            max_tries: 5,
            interval: 2000,
            backoff: 1
        })
    },

    loadFromCache: function(cacheFileName) {

        if (this.refreshCache) {
            return Promise.reject(new Error("Abandon cache"));
        }

        return new Promise(function(resolve, reject) {
            fs.readFile(cacheFileName, function(err, buffer) {
                if (err) {
                    reject(err);
                } else {
                    resolve(buffer);
                }
            })
        });
    },


    crawlSearchPage: function() {

        let self = this;
        var cacheFileName = C.WORKING_DIR + this.movieIdTag + "_search_page";
        return self.loadFromCache(cacheFileName)
            .then(function(buffer) {
                logger.log("Search page loaded from cache: " + cacheFileName);
                return self.getMovieUrlFromSearchResult(buffer);
            })
            .catch(function(err) {
                var url = self.getSearchUrl();
                logger.log("Crawling search page: " + url);
                return self.crawlPage(url)
                    .then(function(result) {
                        let movieUrl = self.getMovieUrlFromSearchResult(result.text);
                        return self.writeToFile(result.text, cacheFileName)
                                .then(() => {return movieUrl});
                    })
            })

    },

    crawlMoviePage: function(movieUrl) {
        logger.log("Crawling movie page: " + movieUrl);

        if (!(movieUrl)) {
            throw new Error(C.NO_SEARCH_RESULT);
            return {};
        }

        let self = this;
        // check search result exists
        var cacheFileName = C.WORKING_DIR + this.movieIdTag + "_movie_page";

        return self.loadFromCache(cacheFileName)
            .then((buffer) => {
                logger.log("movie page loaded from cache: " + cacheFileName);
                return buffer;
            })
            .catch((err) => {
                logger.log("Movie page not cached, crawling from: " + movieUrl);
                return self.crawlPage(movieUrl)
                    .then(function (result) {
                        return self.writeToFile(result.text, cacheFileName)
                            .then(() => {return result.text})
                    })
            })
    },

    parsingMetadata: function(html) {
        var scrapper = new Scrapper();
        return scrapper.scrapeFromHtmlBuffer(html);
    }
}


var generatePosterFromFanart = function(fanartImgFileName, posterImgFileName) {

    if (fs.existsSync(posterImgFileName)) {
        logger.info("poster exists, no need to regenerate: %s", posterImgFileName);
        return Promise.resolve();
    }

    logger.log("generatePosterFromFanart: ");
    logger.log("fanartImgFileName: " + fanartImgFileName);
    logger.log("posterImgFileName: " + posterImgFileName);

    let idTag = utility.getIdTagFromFileName(fanartImgFileName).toString();

    let promise = new Promise(function (resolve, reject) {
        gm(fanartImgFileName)
            .size(function (err, size) {

                if (err) {
                    fs.removeSync(fanartImgFileName);
                    return reject(err);
                }

                let posterImgWidth = size.width;
                let posterImgHeight = size.height;

                var cropWidth = Math.floor(posterImgWidth/2 * 0.95);

                //SOD (SDMS, SDDE) - crop 3 pixels
                if (idTag.search("SDDE") >= 0 || idTag.search("SDMS") >= 0)
                    cropWidth = cropWidth - 3;
                //Natura High - crop 2 pixels
                if (idTag.search("NHDT") >= 0)
                    cropWidth = cropWidth - 2;
                //HTY - crop 1 pixel
                if (idTag.search("HTV") >= 0)
                    cropWidth = cropWidth - 1;
                //Prestige (EVO, DAY, ZER, EZD, DOM) crop 1 pixel
                if (idTag.search("EVO") >= 0 || idTag.search("DAY") >= 0 || idTag.search("ZER") >= 0 || idTag.search("EZD") >= 0 || idTag.search("DOM") >= 0 && posterImgHeight == 522)
                    cropWidth = cropWidth - 1;
                //DOM - overcrop a little
                if (idTag.search("DOM") >= 0 && posterImgHeight == 488)
                    cropWidth = cropWidth + 13;
                //DIM - crop 5 pixels
                if (idTag.search("DIM") >= 0)
                    cropWidth = cropWidth - 5;
                //DNPD - the front is on the left and a different crop routine will be used below
                //CRZ - crop 5 pixels
                if (idTag.search("CRZ") >= 0 && posterImgHeight == 541)
                    cropWidth = cropWidth - 5;
                //FSET - crop 2 pixels
                if (idTag.search("FSET") >= 0 && posterImgHeight == 675)
                    cropWidth = cropWidth - 2;
                //Moodyz (MIRD dual discs - the original code says to center the overcropping but provides no example so I'm not dooing anything for now)
                //Opera (ORPD) - crop 1 pixel
                if (idTag.search("DIM") >= 0)
                    cropWidth = cropWidth - 1;
                //Jade (P9) - crop 2 pixels
                if (idTag.search("P9") >= 0)
                    cropWidth = cropWidth - 2;
                //Rocket (RCT) - Crop 2 Pixels
                if (idTag.search("RCT") >= 0)
                    cropWidth = cropWidth - 2;
                //SIMG - crop 10 pixels
                if (idTag.search("SIMG") >= 0 && posterImgHeight == 864)
                    cropWidth = cropWidth - 10;
                //SIMG - crop 4 pixels
                if (idTag.search("SIMG") >= 0 && posterImgHeight == 541)
                    cropWidth = cropWidth - 4;
                //SVDVD - crop 2 pixels
                if (idTag.search("SVDVD") >= 0 && posterImgHeight == 950)
                    cropWidth = cropWidth - 4;
                //XV-65 - crop 6 pixels
                if (idTag.search("XV-65" >= 0) && posterImgHeight == 750)
                    cropWidth = cropWidth - 6;
                //800x538 - crop 2 pixels
                if (posterImgHeight == 538 && posterImgWidth == 800)
                    cropWidth = cropWidth - 2;
                //800x537 - crop 1 pixel
                if (posterImgHeight == 537 && posterImgWidth == 800)
                    cropWidth = cropWidth - 1;
                if (posterImgHeight == 513 && posterImgWidth == 800)			{
                    cropWidth = cropWidth -14;
                }

                logger.log("%d %d %d %d", 0, posterImgWidth - cropWidth, posterImgWidth, posterImgHeight);

                this.crop(cropWidth, posterImgHeight, posterImgWidth - cropWidth, 0)
                    .write(posterImgFileName, function (err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    })
            })
    })

    return promise;
}

var scrape = function (idtag, refreshCache) {

    let spider = new Spider({
        movieIdTag: idtag,
        refreshCache: refreshCache
    });

    return spider.crawlSearchPage()
        .then(spider.crawlMoviePage.bind(spider))   // step 1: crawl page
        .then(function(htmlBuffer) {                // step 2: scrape metadata & generate nfo
            let metadata = spider.parsingMetadata(htmlBuffer);
            let nfoFileName = utility.getNfoFilePath(metadata.id);

            return fs.writeFile(nfoFileName, metadata.toXMLString())
                .then(() => {
                    return metadata;
                });
        })
        .then((metadata) => {                       // step 3: download fanart file
            logger.log("Checking fanart...");

            var fanartFileName = utility.getFanartFilePath(metadata.id);

            if (!fs.existsSync(fanartFileName)){

                logger.log("Fanart not exists, downloading to %s", fanartFileName);

                return spider.crawlImage(metadata.poster, fanartFileName)
                    .then(() => {
                        logger.log("Fanart downloaded: %s", fanartFileName);
                        return metadata;
                    })
            }

            return metadata;
        })
        .then(function (metadata) {                 // step 4: generate poster

            var fanartFileName = utility.getFanartFilePath(metadata.id);
            var posterFileName = utility.getPosterFilePath(metadata.id);


            return generatePosterFromFanart(fanartFileName, posterFileName)
                .then(() => {return metadata})
        })

}

module.exports = {
    scrape: scrape
}

