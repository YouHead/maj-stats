module.exports = {
  appId: 'cn.majstats.desktop', productName: '雀赛统计',
  directories: { output: 'dist', buildResources: 'build' },
  electronDist: 'node_modules/electron/dist',
  asar: true, npmRebuild: false, compression: 'normal',
  files: ['app/**', 'src/**', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '!**/*.map'],
  extraResources: [{ from: '.cache/release-protocol', to: 'protocol', filter: ['liqi.json', 'version.json'] }],
  win: { target: [{ target: 'portable', arch: ['x64'] }], icon: 'app/icon.ico', signAndEditExecutable: true },
  portable: { artifactName: '雀赛统计-${version}-Windows-${arch}.${ext}', requestExecutionLevel: 'user' },
  publish: null,
};
