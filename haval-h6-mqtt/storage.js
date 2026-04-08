const fs = require("fs");
const { LocalStorage } = require("node-localstorage");

const storagePath = fs.existsSync("/data") ? "/data/gwm-storage" : "./storage";

module.exports = new LocalStorage(storagePath);
