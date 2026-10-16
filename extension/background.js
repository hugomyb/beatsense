// Page de fond Firefox : l'analyse tourne directement ici (Manifest V2 autorise essentia.js).
listen(createActions((videoId) => fetchAndAnalyze(videoId, analyzeSamples)));
