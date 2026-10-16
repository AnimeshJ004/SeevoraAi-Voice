/**
 * Seevora AI Voice - Root Entrypoint
 * Bridges execution to dashboard/server.js
 */
'use strict';

const path = require('path');

// Change working directory to dashboard folder so data/ and public/ are resolved accurately
process.chdir(path.join(__dirname, 'dashboard'));

require(path.join(__dirname, 'dashboard', 'server.js'));
