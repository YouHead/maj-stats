const path = require('node:path');

function resolveAppPaths({ isPackaged, projectRoot, appData, localAppData, testDataDirectory }) {
  if (testDataDirectory && !path.isAbsolute(testDataDirectory)) throw new Error('测试数据目录必须是绝对路径');
  const storageRoot = testDataDirectory || (isPackaged ? path.join(localAppData || appData, 'MajStats') : projectRoot);
  const local = isPackaged || testDataDirectory ? storageRoot : path.join(storageRoot, '.local');
  return {
    storageRoot, local, profile: path.join(local, 'profile'),
    contests: path.join(storageRoot, 'data', 'contests'),
    legacy: isPackaged ? null : path.join(storageRoot, 'data', 'replays'),
    cache: path.join(storageRoot, isPackaged ? 'cache' : '.cache'),
    settings: path.join(local, 'settings.json'), runtime: path.join(local, 'runtime.json'),
  };
}
module.exports = { resolveAppPaths };
