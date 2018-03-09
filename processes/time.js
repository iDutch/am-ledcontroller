const moment = require('moment');
const Timer = require('./../classes/timer');

new Timer(() => {
    process.send({time: moment().format('HH:mm'), date: moment().format('DD/MM/YYYY')});
}, 1000);
