const fs = require('fs');
const path = require('path');

const targetFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native',
  'ReactAndroid',
  'cmake-utils',
  'ReactNative-application.cmake'
);

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');
  if (!content.includes('target_link_libraries(common_flags INTERFACE c++_shared)')) {
    content = content.replace(
      'target_compile_options(common_flags INTERFACE ${folly_FLAGS})',
      'target_compile_options(common_flags INTERFACE ${folly_FLAGS})\ntarget_link_libraries(common_flags INTERFACE c++_shared)'
    );
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('[patch-rn-cmake] Successfully patched ReactNative-application.cmake for NDK 27 c++_shared linkage.');
  } else {
    console.log('[patch-rn-cmake] ReactNative-application.cmake is already patched.');
  }
}

