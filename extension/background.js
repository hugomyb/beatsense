// Firefox background page: the analysis runs right here (Manifest V2 allows essentia.js).
listen(createActions((videoId) => fetchAndAnalyze(videoId, analyzeSamples)));
