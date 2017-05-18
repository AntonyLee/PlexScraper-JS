/**
 * Created by abusimbely on 2017/5/8.
 */

var fs = require("fs"),
    cheerio = require("cheerio"),
    request = require("superagent"),
    eventproxy = require("eventproxy"),
    retry = require("bluebird-retry"),
    Sharp = require("sharp"),
    format = require('string-format'),
    path = require("path")


var debug = require("debug")("spider");

var Scrapper = require("./scrapper.js");


const WORKING_DIR = "./working_dir/";
// const MOVE_TO_DIR_ROOT = "D:/1-movies/5-ad\ults/jav/"

function Spider(options) {
    options = this.options = options || {};

    this.movieIdTag = options.movieIdTag;
}

Spider.prototype = {
    constructor: Spider,

    getSearchUrl() {
        return "www.avmoo.com/cn/search/" + this.movieIdTag;
    },

    writeToFile: function (htmlText, fileToWrite) {
        var self = this;

        fs.writeFile(fileToWrite, htmlText, (err) => {
            if (err)
                throw err;
            else
                debug("Search result of " + self.movieIdTag + " saved to file " + fileToWrite);
        })
    },

    getMovieUrlFromSearchResult: function (searchResult) {

        var self = this;

        var $ = cheerio.load(searchResult);
        var movieUrl = $(".movie-box").attr("href");

        debug("Movie Url = " + movieUrl);

        return movieUrl;
    },

    crawlPage: function(url) {
        var self = this;
        // request from server
        return retry(function () {
            debug("Crawling page: " + url);

            return request.get(url)
                .then(function (response) {
                    // success
                    let result = response.res;
                    debug("result.statusCode = " + result.statusCode);
                    if (result && result.statusCode === 200) {
                        debug("result.returnValue = " + result.returnValue);
                        debug("search url SUCCESS!");
                        return result;
                    } else {
                        throw new Error("search idtag failed");
                    }
                })
                .catch(function (error) {
                    debug("connection reset");
                    throw new Error("search idtag failed");
                })
        }, {
            max_tries: 10,
            interval: 5000,
            backoff: 1,
        })
        .then(function (result) {
            debug("request search result SUCCESS");
            // get the search result
            return result;
        })
        .catch(function(error) {
            debug("error = " + error);
            return {};
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
        var cacheFileName = WORKING_DIR + this.movieIdTag + "_search_page";
        return self.loadFromCache(cacheFileName)
            .then(function(buffer) {
                debug("search page loaded from cache: " + cacheFileName);
                return self.getMovieUrlFromSearchResult(buffer);
            })
            .catch(function(err) {
                var url = self.getSearchUrl();
                debug("search page requesting from: " + url);
                return self.crawlPage(url)
                    .then(function(result) {
                        self.writeToFile(result.text, cacheFileName);
                        return self.getMovieUrlFromSearchResult(result.text);
                    });
            })

    },

    crawlMoviePage: function(movieUrl) {
        debug("Crawling movie page: " + movieUrl);
        let self = this;
        // check search result exists
        var cacheFileName = WORKING_DIR + this.movieIdTag + "_movie_page";

        return self.loadFromCache(cacheFileName)
            .then((buffer) => {
                debug("movie page loaded from cache: " + cacheFileName);
                return buffer;
            })
            .catch((err) => {
                debug("movie page requesting from: " + movieUrl);
                return self.crawlPage(movieUrl)
                    .then(function (result) {
                        self.writeToFile(result.text, cacheFileName);
                        return result.text;
                    })
                    .catch(function (err) {
                        debug(err);
                    })
            })
    },

    parsingMetadata: function(html) {
        // debug(html);
        var scrapper = new Scrapper();
        return scrapper.scrapeFromHtmlBuffer(html);
    }
}


var downloadImage = function(url, dst) {

    debug("Start downloading image url = ", url);
    var httpStream = request.get(url);
    var writeStream = fs.createWriteStream(dst);

    var totalLength = 0;
    httpStream.on("data", (chunk) => {
        totalLength += chunk.length;
        debug("received data %d", totalLength);
    })

    httpStream.pipe(writeStream);

    return streamToPromise(writeStream);
}

var generatePosterFromFanart = function(fanartImgFileName, posterImgFileName) {

    debug("generatePosterFromFanart: ");
    debug("fanartImgFileName: " + fanartImgFileName);
    debug("posterImgFileName: " + posterImgFileName);

    var image = Sharp(fanartImgFileName);

    image.metadata(function (err, metadata) {
        var posterImgWidth = metadata.width;
        var posterImgHeight = metadata.height;

        debug("{posterImgWidth: %d, posterImgHeight : %d}", posterImgWidth, posterImgHeight);

        var cropWidth = Math.floor(posterImgWidth/2.11);

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

        debug("%s %s %s", cropWidth, posterImgWidth, posterImgHeight);

        image.resize(cropWidth, posterImgHeight)
            .crop(Sharp.gravity.east)
            .on("error", function(err) {
                debug(err);
            })
            .toFile(posterImgFileName);
    })
}


var scrape = function(idtag) {
    debug("start scrapping : " + idtag);
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
    spider.crawlSearchPage()
        .then(spider.crawlMoviePage.bind(spider))   // step 1: crawl page
        .then(function(htmlBuffer) {                // step 2: scrape metadata & download image file
            var metadata = spider.parsingMetadata(htmlBuffer);
            var fanartFileName = WORKING_DIR+metadata.id+"-fanart.jpg";

            if (!fs.existsSync(fanartFileName)){
                return downloadImage(metadata.fanart, fanartFileName)
                    .then(() => {
                        debug("Fanart downloaded: %s", fanartFileName);
                        return metadata;
                    })
            }

            return metadata;
        })
        .then(function (metadata) {                 // step 3: generate poster

            var fanartFileName = WORKING_DIR+metadata.id+"-fanart.jpg";
            var posterFileName = WORKING_DIR+metadata.id+"-poster.jpg";

            generatePosterFromFanart(fanartFileName, posterFileName);
            return metadata;
        })                                          // step 4: write nfo file
        .then((metadata) => {
            let nfoFileName = WORKING_DIR+metadata.id+".nfo";
            let writeStream = fs.createWriteStream(nfoFileName);
            writeStream.write(metadata.toXMLString());
            return streamToPromise(writeStream).then(() => {return metadata});
        })
}

module.exports = {
    scrape: scrape
}

