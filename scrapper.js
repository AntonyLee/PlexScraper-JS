
var cheerio = require("cheerio"),
    regex_const = require("./const.js");
    XMLWriter = require("xml-writer"),
    fs = require("fs-extra"),
    utility = require("./utility")



var logger = utility.requireLogger();

function Scrapper() {
}

Scrapper.prototype = {

    constructor: Scrapper,

    scrapeIDTag: function($) {
        // id tag
        var element = $("div.container p:contains(ID:), p:contains(识别码:)").first();
        if (element) {
            var idText = element.text().trim();
            idText = idText.replace("识别码: ", "");
            logger.log("metadata.id = " + idText);
            return idText;
        } else {
            throw new Error("scrape id tag failed");
        }
    },

    scrapeTitle: function($) {
        var element = $("div.container h3").first();
        if (element) {
            var title = element.text().trim();
            title = title.replace(regex_const.REGEX_IDTAG, "");
            title = title.trim();
            logger.log("Movie title scrapped = " + title);
            return title;

        } else {
            throw new Error("Can't find title element in html");
        }
    },

    scrapeActors: function($) {
        var elements = $("div#avatar-waterfall a.avatar-box");
        var actors = new Array();
        if (elements) {
            elements.each(function(index, element) {
                var actorName = $(this).find("span").first().text().trim();
                var actorThumbUrl = $(this).find("img").first().attr("src");

                if (actorThumbUrl.search("NowPrinting.gif") > 0)
                    actorThumbUrl = "";

                actors.push({
                    actorName: actorName,
                    actorThumbUrl: actorThumbUrl,
                })
            })
        }

        logger.log("Actors:");
        actors.forEach(function (actor) {
            logger.log(actor.actorName);
            logger.log(actor.actorThumbUrl);
        })

        return actors;
    },

    scrapeReleaseDate($) {

        var element = $("div.container p:contains(ID:), p:contains(发行时间:)").first();

        var releaseDate = element.text().trim();
        releaseDate = releaseDate.replace("发行时间:", "").trim();

        logger.log("Release Date = " + releaseDate);
        return releaseDate;
    },

    scrapeGenre($) {
        var elements = $(".genre");
        var genres = new Array();
        if (elements) {
            elements.each(function(index, element) {
                genres.push($(this).text().trim());
            })
        }

        var genreString = "";
        genres.forEach(function(genre) {
            genreString += genre + " ";
        });
        logger.log("Genres: " + genreString);

        return genres;
    },

    scrapeDirector($) {
        var element = $("div.container p:contains(导演:)").first();
        var director = "";

        director = element.text();
        director = director.replace("导演: ", "").trim();

        logger.log("director: " + director);

        return director;
    },

    scrapeStudio($) {
        var element = $("div.container p:contains(制作商:)").first().next();

        var studio = element.text().replace("制作商:", "").trim();
        studio = studio.replace("/", "");
        logger.log("Studio: " + studio);

        return studio;
    },

    scrapeLabel($) {
        var element = $("div.container p:contains(发行商:)").first().next();

        var label = element.text().replace("发行商:", "").trim();

        logger.log("Label: " + label);

        return label;
    },

    scrapePoster($) {
        var element = $("a.bigImage img").first();
        var fanart = element.attr("src").trim();
        logger.log("poster url = " + fanart);
        return fanart;
    },

    scrapeFanart($) {
        var elements = $("div#sample-waterfall a.sample-box");
        let array = []
        if (elements) {
            elements.each((index, ele) => {
                let url = ele.attribs.href;
                array.push(url);
            })
        }
        return array;
    },

    scrapeFromHtmlBuffer(buffer) {

        logger.log("Start scrapping...");

        var metadata = {};

        var $ = cheerio.load(buffer);

        try{
            metadata.id = this.scrapeIDTag($);
            metadata.title = this.scrapeTitle($);
            metadata.actors = this.scrapeActors($);
            metadata.releaseDate = this.scrapeReleaseDate($);
            metadata.genres = this.scrapeGenre($);
            metadata.director = this.scrapeDirector($);
            metadata.studio = this.scrapeStudio($);
            metadata.studio = metadata.studio.replace("アイデアポケット", "IDEA POCKET");
            metadata.label = this.scrapeLabel($);
            metadata.poster = this.scrapePoster($);
            metadata.fanarts = this.scrapeFanart($);

            metadata.actors.toString = function () {
                var actorString = ""
                metadata.actors.forEach((ele, idx, array) => {
                    actorString += ele.actorName;
                    if (idx < array.length - 1)
                        actorString += ", ";
                })
                logger.log(actorString);
                return actorString;
            }

            metadata.toXMLString = function (){
                var xw = new XMLWriter;

                try {
                    xw.startDocument();
                    let movie = xw.startElement("movie");
                    movie.writeElement("id", this.id);
                    movie.writeElement("title", this.id+" "+this.title);
                    movie.writeElement("year", this.releaseDate.slice(0, 4));
                    movie.writeElement("releaseDate", this.releaseDate);
                    movie.writeElement("studio", this.studio);
                    movie.writeElement("thumb", this.poster)
                    let fanartElement = movie.startElement("fanart");
                    this.fanarts.forEach((fanart) => {
                        fanartElement.writeElement("thumb", fanart);
                    })
                    fanartElement.endElement();
                    movie.writeElement("director", this.director);
                    this.genres.forEach((genre) => {
                        movie.writeElement("genre", genre);
                    });
                    this.actors.forEach((actor) => {
                        let  actorElement = movie.startElement("actor");
                        actorElement.writeElement("name", actor.actorName);
                        actorElement.writeElement("thumb", actor.actorThumbUrl);
                        actorElement.endElement();
                    })
                    movie.endElement();
                    xw.endDocument();

                    logger.debug("xw.toString() " + xw.toString());
                } catch (err) {
                    logger.error(err);
                    throw err;
                }
                return xw.toString();
            }


        } catch(err) {
            logger.error(err);
            throw err;
        }

        return metadata;
    },


}

module.exports = Scrapper;