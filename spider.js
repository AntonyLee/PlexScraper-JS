/**
 * Created by abusimbely on 2017/5/8.
 */

var fs = require("fs-extra"),
    cheerio = require("cheerio"),
    request = require("superagent"),
    progress = require("superagent-progress"),
    eventproxy = require("eventproxy"),
    retry = require("bluebird-retry"),
    gm = require("gm"),
    format = require('string-format'),
    path = require("path"),
    logger = require("tracer").colorConsole()

require("superagent-retry")(request);

var Scrapper = require("./scrapper.js");
    utility = require("./utility"),
    env = require("./const")

function Spider(options) {
    options = this.options = options || {};

    this.movieIdTag = options.movieIdTag;
}

Spider.prototype = {
    constructor: Spider,

    getSearchUrl() {
        // return "www.avmoo.com/cn/search/" + this.movieIdTag;
        return "https://avio.pw/cn/search/" + this.movieIdTag;
    },

    writeToFile: function (htmlText, fileToWrite) {
        var self = this;

        fs.writeFile(fileToWrite, htmlText, (err) => {
            if (err)
                throw err;
            else
                logger.log("Search result of " + self.movieIdTag + " saved to file " + fileToWrite);
        })
    },

    getMovieUrlFromSearchResult: function (searchResult) {

        var self = this;

        var $ = cheerio.load(searchResult);
        var movieUrl = $(".movie-box").attr("href");

        logger.log("Movie Url = " + movieUrl);

        return movieUrl;
    },

    crawlPage: function(url) {
        var self = this;
        // request from server
        return retry(function () {
            logger.log("Crawling page: " + url);

            return request.get(url)
                .timeout({
                    response: 2000,
                    deadline: 20000,
                })
                .then(function (response) {
                    // success
                    let result = response.res;
                    logger.log("result.statusCode = " + result.statusCode);
                    if (result && result.statusCode === 200) {
                        logger.log("search url SUCCESS!");
                        return result;
                    } else {
                        throw new Error("search idtag failed");
                    }
                })
                .catch(function (error) {
                    logger.log("connection reset");
                    throw new Error("search idtag failed");
                })
        }, {
            max_tries: 10,
            interval: 5000,
            backoff: 1,
        })
        .then(function (result) {
            logger.log("request search result SUCCESS");
            // get the search result
            return result;
        })
    },


    loadFromCache: function(cacheFileName) {
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
        var cacheFileName = env.WORKING_DIR + this.movieIdTag + "_search_page";
        return self.loadFromCache(cacheFileName)
            .then(function(buffer) {
                logger.log("search page loaded from cache: " + cacheFileName);
                return self.getMovieUrlFromSearchResult(buffer);
            })
            .catch(function(err) {
                var url = self.getSearchUrl();
                logger.log("search page requesting from: " + url);
                return self.crawlPage(url)
                    .then(function(result) {
                        self.writeToFile(result.text, cacheFileName);
                        return self.getMovieUrlFromSearchResult(result.text);
                    })
            })

    },

    crawlMoviePage: function(movieUrl) {
        logger.log("Crawling movie page: " + movieUrl);
        let self = this;
        // check search result exists
        var cacheFileName = env.WORKING_DIR + this.movieIdTag + "_movie_page";

        return self.loadFromCache(cacheFileName)
            .then((buffer) => {
                logger.log("movie page loaded from cache: " + cacheFileName);
                return buffer;
            })
            .catch((err) => {
                logger.log("movie page requesting from: " + movieUrl);
                return self.crawlPage(movieUrl)
                    .then(function (result) {
                        self.writeToFile(result.text, cacheFileName);
                        return result.text;
                    })
                    .catch(function (err) {
                        logger.log(err);
                    })
            })
    },

    parsingMetadata: function(html) {
        // logger.log(html);
        var scrapper = new Scrapper();
        return scrapper.scrapeFromHtmlBuffer(html);
    }
}


var downloadImage = function(url, dst) {

    logger.log("Start downloading image url = ", url);
    return retry(function () {
        var httpStream = request.get(url)
            .timeout({
                response: 20000,
                deadline: 120000,
            })
            .on("response", (response) => {
                response
                    .on("data", function (chunk) {
                        logger.log("downloading... %s", chunk.length);
                    })
                    .on("error", function (err) {
                        logger.log("downloading timeout");
                        throw err;
                    })

                logger.log(response.statusCode);
            })
            .on("error", (err) => {
                logger.error(err);
                if (err.timeout) {
                    logger.debug("TIMEOUT!!!");
                    throw err;
                }
            })
            .on("end", (err, resposne) => {
                logger.log(err, resposne);
            })

        var writeStream = fs.createWriteStream(dst);
        httpStream.pipe(writeStream);

        return new Promise(function (resolve, reject) {

            writeStream.on("close", function () {
                logger.debug("writeStream end");

                resolve();
            });
            writeStream.on("error", reject);
        })
    }, {
        max_tries: 3,
        interval: 1000,
        backoff: 1
    })
}

var generatePosterFromFanart = function(fanartImgFileName, posterImgFileName) {

    if (fs.existsSync(posterImgFileName)) {
        logger.log("poster exists, no need to regenerate: %s", posterImgFileName);
        return ;
    }

    logger.log("generatePosterFromFanart: ");
    logger.log("fanartImgFileName: " + fanartImgFileName);
    logger.log("posterImgFileName: " + posterImgFileName);


    let promise = new Promise(function (resolve, reject) {
        gm(fanartImgFileName)
            .size(function (err, size) {

                if (err) {
                    reject(err);
                }

                let posterImgWidth = size.width;
                let posterImgHeight = size.height;

                logger.log("{posterImgWidth: %d, posterImgHeight : %d}", posterImgWidth, posterImgHeight);

                var cropWidth = Math.floor(posterImgWidth/2 * 0.95);

                //SOD (SDMS, SDDE) - crop 3 pixels
                if (fanartImgFileName.search("SDDE") || fanartImgFileName.search("SDMS"))
                    cropWidth = cropWidth - 3;
                //Natura High - crop 2 pixels
                if (fanartImgFileName.search("NHDT"))
                    cropWidth = cropWidth - 2;
                //HTY - crop 1 pixel
                if (fanartImgFileName.search("HTV"))
                    cropWidth = cropWidth - 1;
                //Prestige (EVO, DAY, ZER, EZD, DOM) crop 1 pixel
                if (fanartImgFileName.search("EVO") || fanartImgFileName.search("DAY") || fanartImgFileName.search("ZER") || fanartImgFileName.search("EZD") || fanartImgFileName.search("DOM") && posterImgHeight == 522)
                    cropWidth = cropWidth - 1;
                //DOM - overcrop a little
                if (fanartImgFileName.search("DOM") && posterImgHeight == 488)
                    cropWidth = cropWidth + 13;
                //DIM - crop 5 pixels
                if (fanartImgFileName.search("DIM"))
                    cropWidth = cropWidth - 5;
                //DNPD - the front is on the left and a different crop routine will be used below
                //CRZ - crop 5 pixels
                if (fanartImgFileName.search("CRZ") && posterImgHeight == 541)
                    cropWidth = cropWidth - 5;
                //FSET - crop 2 pixels
                if (fanartImgFileName.search("FSET") && posterImgHeight == 675)
                    cropWidth = cropWidth - 2;
                //Moodyz (MIRD dual discs - the original code says to center the overcropping but provides no example so I'm not dooing anything for now)
                //Opera (ORPD) - crop 1 pixel
                if (fanartImgFileName.search("DIM"))
                    cropWidth = cropWidth - 1;
                //Jade (P9) - crop 2 pixels
                if (fanartImgFileName.search("P9"))
                    cropWidth = cropWidth - 2;
                //Rocket (RCT) - Crop 2 Pixels
                if (fanartImgFileName.search("RCT"))
                    cropWidth = cropWidth - 2;
                //SIMG - crop 10 pixels
                if (fanartImgFileName.search("SIMG") && posterImgHeight == 864)
                    cropWidth = cropWidth - 10;
                //SIMG - crop 4 pixels
                if (fanartImgFileName.search("SIMG") && posterImgHeight == 541)
                    cropWidth = cropWidth - 4;
                //SVDVD - crop 2 pixels
                if (fanartImgFileName.search("SVDVD") && posterImgHeight == 950)
                    cropWidth = cropWidth - 4;
                //XV-65 - crop 6 pixels
                if (fanartImgFileName.search("XV-65") && posterImgHeight == 750)
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

var scrape = function(idtag) {

    logger.log("start scrapping : " + idtag);
    let spider = new Spider({movieIdTag: idtag});
    return spider.crawlSearchPage()
        .then(spider.crawlMoviePage.bind(spider))   // step 1: crawl page
        .then(function(htmlBuffer) {
            var metadata = spider.parsingMetadata(htmlBuffer);
            return metadata;
        })
}


var scrapeFull = function (idtag) {
    let spider = new Spider({movieIdTag: idtag});
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

                return downloadImage(metadata.fanart, fanartFileName)
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
        .catch( (err) => {
            logger.log(err);
        })

}

module.exports = {
    scrape: scrape,
    scrapeFull: scrapeFull
}

