const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'Studio GrayShades Backend',
  description: 'Node.js Express backend server for Studio GrayShades POS',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ]
});

// Listen for the "install" event
svc.on('install', function() {
  console.log('Service installed successfully!');
  svc.start();
  console.log('Service started successfully! The backend is now running in the background.');
});

// Listen for the "alreadyinstalled" event
svc.on('alreadyinstalled', function() {
  console.log('This service is already installed.');
});

// Listen for the "error" event
svc.on('error', function(err) {
  console.error('An error occurred during installation:', err);
});

console.log('Installing service...');
svc.install();
