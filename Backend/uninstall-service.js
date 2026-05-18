const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'Studio GrayShades Backend',
  script: path.join(__dirname, 'server.js')
});

// Listen for the "uninstall" event so we know when it's done.
svc.on('uninstall', function() {
  console.log('Uninstall complete. The service has been removed.');
  console.log('The service exists: ', svc.exists);
});

// Listen for errors
svc.on('error', function(err) {
  console.error('An error occurred during uninstallation:', err);
});

// Uninstall the service.
console.log('Uninstalling service...');
svc.uninstall();
