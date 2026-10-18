import { In } from 'typeorm';
import { SearchSource, inOrder, publishedRoot } from '../common/search/search-source';
import { LiveEvent, Tour } from './entities/live-event.entity';
import { eventEntries, tourEntries } from './live-event-entries';
import { eventSchema, tourSchema } from './live-event.resource';

/* What global search finds of live events: the titles of events and tours. */

export const EVENT_SEARCH: SearchSource = {
  type: 'events',
  schema: eventSchema,
  textsSql: `SELECT event.id::text AS id, event.title AS text FROM events event ${publishedRoot('event')}`,
  load: async (manager, ids) => {
    const events = await manager.find(LiveEvent, { where: { id: In(ids.map(Number)) }, relations: { editorialEntity: true, country: true } });
    return eventEntries(manager, inOrder(ids, events, ({ id }) => id), false);
  },
};

export const TOUR_SEARCH: SearchSource = {
  type: 'tours',
  schema: tourSchema,
  textsSql: `SELECT tour.id::text AS id, tour.title AS text FROM tours tour ${publishedRoot('tour')}`,
  load: async (manager, ids) => {
    const tours = await manager.find(Tour, { where: { id: In(ids.map(Number)) }, relations: { editorialEntity: true } });
    return tourEntries(manager, inOrder(ids, tours, ({ id }) => id), false);
  },
};
