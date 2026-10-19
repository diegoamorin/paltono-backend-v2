import { titleSearch } from '../common/search/search-source';
import { LiveEvent, Tour } from './entities/live-event.entity';
import { eventEntries, tourEntries } from './live-event-entries';
import { eventSchema, tourSchema } from './live-event.resource';

/* What global search finds of live events: the titles of events and tours. */

export const EVENT_SEARCH = titleSearch({
  type: 'events',
  schema: eventSchema,
  table: 'events',
  alias: 'event',
  entity: LiveEvent,
  relations: { editorialEntity: true, country: true },
  entries: (manager, events) => eventEntries(manager, events, false),
});

export const TOUR_SEARCH = titleSearch({
  type: 'tours',
  schema: tourSchema,
  table: 'tours',
  alias: 'tour',
  entity: Tour,
  relations: { editorialEntity: true },
  entries: (manager, tours) => tourEntries(manager, tours, false),
});
