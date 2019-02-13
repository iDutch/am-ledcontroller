const moment = require('moment');
const Timer = require('./../classes/timer');

new Timer(() => {
    process.send({time: moment().format('HH:mm:ss'), date: moment().format('DD/MM/YYYY')});
}, true, 1000);
