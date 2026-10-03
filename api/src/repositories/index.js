/**
 * src/repositories/index.js
 * ---------------------------------------------------------------------------
 * Chooses the data source once, at start-up, based on DATA_SOURCE in .env.
 *
 *   DATA_SOURCE=mysql  (default, submitted configuration) -> MySQL database
 *   DATA_SOURCE=local                                     -> offline mirror
 *
 * The rest of the application only ever imports this module, so swapping the
 * data source never touches a route, controller or service.
 *
 * A3 shape
 *   Each data source is now two modules instead of one:
 *     read  -> repository.mysql.js          | repository.local.js
 *     write -> write.repository.mysql.js    | write.repository.local.js
 *   They are merged into one object below, so a caller still writes
 *   `repository.insertEvent(...)` and never needs to know which half it came
 *   from. Both halves expose exactly the same method names in both modes, which
 *   is what lets the automated test suite run twice - once against MySQL and
 *   once against the offline mirror - and compare the results.
 */
'use strict';

const env = require('../config/env');

const mysqlRepository = require('./repository.mysql');
const localRepository = require('./repository.local');
const mysqlWrites = require('./write.repository.mysql');
const localWrites = require('./write.repository.local');
const mysqlRegistrations = require('./registration.repository.mysql');
const localRegistrations = require('./registration.repository.local');
const localStore = require('./local-store');

const useMysql = env.DATA_SOURCE !== 'local';

if (env.DATA_SOURCE !== 'mysql' && env.DATA_SOURCE !== 'local') {
  console.warn(
    `[repositories] Unknown DATA_SOURCE "${env.DATA_SOURCE}" - falling back to mysql.`
  );
}

const repository = useMysql ? mysqlRepository : localRepository;
const writes = useMysql ? mysqlWrites : localWrites;
const registrations = useMysql ? mysqlRegistrations : localRegistrations;

/** Every write method, surfaced on the same object as the read methods. */
repository.insertEvent = writes.insertEvent.bind(writes);
repository.updateEvent = writes.updateEvent.bind(writes);
repository.deleteEvent = writes.deleteEvent.bind(writes);
repository.replaceTicketTypes = writes.replaceTicketTypes.bind(writes);

/** Registration writes: create, update, delete. */
repository.insertRegistration = registrations.insertRegistration.bind(registrations);
repository.updateRegistration = registrations.updateRegistration.bind(registrations);
repository.deleteRegistration = registrations.deleteRegistration.bind(registrations);

/** Registration reads. MySQL keeps them with the other reads; local mode has
 *  one module for both halves, so it is already on the object. */
if (!repository.registrationQueries) {
  repository.registrationQueries = {
    findByEventId: registrations.findByEventId.bind(registrations),
    findById: registrations.findById.bind(registrations),
    findAll: registrations.findAll.bind(registrations),
    countByEventId: registrations.countByEventId.bind(registrations),
    existsForEventAndEmail: registrations.existsForEventAndEmail.bind(registrations),
  };
}

/**
 * Put the offline data source back to its seeded state.               A3
 *
 * Only meaningful with DATA_SOURCE=local, where the "database" is an array in
 * memory. The automated test suite calls it between cases so a test that
 * creates or deletes an event cannot change the result of the next one. Calling
 * it against MySQL would drop rows from the real database, so it refuses.
 */
repository.resetLocalData = function resetLocalData() {
  if (useMysql) {
    throw new Error(
      'resetLocalData() is only available with DATA_SOURCE=local. ' +
        'Reload database/charityevents_db.sql to reset MySQL.'
    );
  }
  localStore.reset();
  return true;
};

/** The write half, exported on its own for the unit tests. */
repository.writes = writes;

module.exports = repository;
module.exports.driver = repository.driver;
