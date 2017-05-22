
const REGEX_IDTAG = /[A-Za-z]{2,5}-?[0-9]{3,5}/;

const WORKING_DIR = "./plex_scrapper_cache/";
const LOG_LOC = "./plex_scrapper_cache/scrape.log"
const MOVE_TO_DIR_ROOT = "./test/1-videos/5-adults/jav/"
// const WORKING_DIR = "D:/./plex_scrapper_cache/";
// const MOVE_TO_DIR_ROOT = "D:/1-videos/5-adults/jav/"
// const LOG_LOC = "D:/./plex_scrapper_cache/scrape.log"



module.exports = {
    REGEX_IDTAG: REGEX_IDTAG,
    WORKING_DIR: WORKING_DIR,
    MOVE_TO_DIR_ROOT: MOVE_TO_DIR_ROOT,
    LOG_LOC: LOG_LOC
}