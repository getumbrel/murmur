// electron-builder's beforeBuild hook. desktop/app has no dependencies (main.js
// bundles everything), so there is nothing to install, rebuild or copy; without
// this, electron-builder would package the web app's node_modules from the root.
module.exports = async () => false
