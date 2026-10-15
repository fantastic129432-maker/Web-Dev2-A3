/**
 * @file Chooses the data source once, at start-up, based on DATA_SOURCE in .env.
 *
 *   DATA_SOURCE=mysql  (default, submitted configuration) -> MySQL database
 *   DATA_SOURCE=local                                     -> offline mirror
 *
 * The rest of the application only ever imports this module, so swapping the
 * data source never touches a route, controller or service.
 *
 * A3 shape
 *   Each data source is now two modules instead of one:
 *     read  -> repository.mysql.ts          | repository.local.ts
 *     write -> write.repository.mysql.ts    | write.repository.local.ts
 *   They are merged into one object below, so a caller still writes
 *   `repository.insertEvent(...)` and never needs to know which half it came
 *   from. Both halves expose exactly the same method names in both modes, which
 *   is what lets the automated test suite run twice - once against MySQL and
 *   once against the offline mirror - and compare the results.
 *
 * TypeScript note
 *   The two halves are merged by ASSIGNMENT (exactly as they were merged in
 *   JavaScript) rather than by inheritance, because that is what makes the
 *   merged object the same object the read repository already exported. The
 *   compiler cannot see members that are attached after a module is loaded, so
 *   the read half is asserted once against the `Repository` contract in
 *   src/types.ts - the same contract that types every caller. Each half still
 *   checks its own exports against that contract where it is defined.
 */
'use strict';

import env = require('../config/env');
import type {
  EventWriteRepository,
  RegistrationQueries,
  RegistrationWriteRepository,
  Repository,
} from '../types';

import mysqlRepository = require('./repository.mysql');
import localRepository = require('./repository.local');
import mysqlWrites = require('./write.repository.mysql');
import localWrites = require('./write.repository.local');
import mysqlRegistrations = require('./registration.repository.mysql');
import localRegistrations = require('./registration.repository.local');
import localStore = require('./local-store');

const useMysql = env.DATA_SOURCE !== 'local';

if (env.DATA_SOURCE !== 'mysql' && env.DATA_SOURCE !== 'local') {
  console.warn(
    `[repositories] Unknown DATA_SOURCE "${env.DATA_SOURCE}" - falling back to mysql.`
  );
}

/** The read half of the selected data source, plus every write method below. */
const repository = (
  useMysql ? mysqlRepository : localRepository
) as unknown as Repository;

/** Every write method, surfaced on the same object as the read methods. */
const writes: EventWriteRepository = useMysql ? mysqlWrites : localWrites;

/**
 * Registration writes, plus the reads MySQL keeps in its own module.
 *
 * MySQL publishes its registration reads as `registrationQueries` on the read
 * repository and keeps the writes in registration.repository.mysql.ts. The
 * offline mirror keeps reads AND writes on one object
 * (registration.repository.local.ts). The assertion below records that both
 * pairs expose the same member names; the `if` underneath is the documented
 * fallback for a data source whose reads are not already on the read half, so
 * it is a no-op for both configured sources - and is kept so the intent stays
 * visible.
 */
const registrations = (useMysql
  ? mysqlRegistrations
  : localRegistrations) as unknown as RegistrationQueries &
  RegistrationWriteRepository;

/**
 * Attach the write half to the read object.
 *
 * Each method is bound to the object of its own module, so the merged repository
 * never depends on `this` being the right thing at call time - which is what
 * lets identical service code call `repository.insertEvent(...)` whichever data
 * source produced it.
 */
repository.insertEvent = writes.insertEvent.bind(writes);
repository.updateEvent = writes.updateEvent.bind(writes);
repository.deleteEvent = writes.deleteEvent.bind(writes);
repository.replaceTicketTypes = writes.replaceTicketTypes.bind(writes);

/** Registration writes: create, update, delete. */
repository.insertRegistration = registrations.insertRegistration.bind(registrations);
repository.updateRegistration = registrations.updateRegistration.bind(registrations);
repository.deleteRegistration = registrations.deleteRegistration.bind(registrations);

/**
 * Registration reads.
 *
 * MySQL keeps them with the other reads; local mode has one module for both
 * halves, so it is already on the object.
 */
if (!repository.registrationQueries) {
  repository.registrationQueries = {
    findByEventId: registrations.findByEventId.bind(registrations),
    findPublicForEvent: registrations.findPublicForEvent.bind(registrations),
    findById: registrations.findById.bind(registrations),
    findAll: registrations.findAll.bind(registrations),
    countByEventId: registrations.countByEventId.bind(registrations),
    existsForEventAndEmail: registrations.existsForEventAndEmail.bind(registrations),
  };
}

/**
 * Put the offline data source back to its seeded state.
 *
 * Only meaningful with DATA_SOURCE=local, where the "database" is an array in
 * memory. The automated test suite calls it between cases so a test that
 * creates or deletes an event cannot change the result of the next one. Calling
 * it against MySQL would drop rows from the real database, so it refuses.
 *
 * @returns `true` once the offline store has been re-seeded; the value is only
 *   ever `true`, because the MySQL case throws instead.
 * @throws Error when the selected data source is MySQL, where a reset would destroy real rows.
 */
repository.resetLocalData = function resetLocalData(): boolean {
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

/**
 * The merged repository, and the only thing this module exports.
 *
 * `driver` used to be re-assigned here as a named export of its own
 * (`module.exports.driver = repository.driver`). It is already a member of the
 * object below, so the single export still exposes `repository.driver`.
 */
export = repository;
