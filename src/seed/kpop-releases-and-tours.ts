import { PartialDateValue } from '../catalog-identities/identity-creations';
import { EventStatus } from '../live-events/entities/live-event.entity';
import { EventSpec, RecordingSpec, TrackSpec } from './catalog-writer';
import { SeedSubmission, wiki } from './kpop-catalog';

/*
 * The releases, tours and concerts of the seed, written after the identities,
 * works and recordings of `kpop-catalog.ts` they refer to. Each is backed by
 * the articles it was taken from (checked in October 2026): English Wikipedia
 * where it covers them, and the press for announcements it does not cover
 * yet. Tracklists, times, venues and credits the sources leave out stay empty.
 */

/** A recording known only by its title, such as an album track. */
const recording = (key: string, title: string, works: RecordingSpec['works'] = []): RecordingSpec => ({ key, title, works });

/** Consecutive tracks of disc 1, from its first position, by recording key. */
const tracks = (...keys: string[]): TrackSpec[] => keys.map((key) => ({ recording: key }));

const day = (year: number, month: number, dayOfMonth: number): PartialDateValue => ({ year, month, day: dayOfMonth });

const JENNIE_FEATURES: Record<string, string> = {
  'ruby/intro-jane': 'fkj',
  'ruby/handlebars': 'dua-lipa',
  'ruby/extral': 'doechii',
  'ruby/love-hangover': 'dominic-fike',
};

/** A track of Ruby, presented with Jennie and, when it has one, its featured artists. */
const rubyTrack = (key: string): TrackSpec => {
  const featured = key === 'ruby/damn-right' ? ['childish-gambino', 'kali-uchis'] : JENNIE_FEATURES[key] ? [JENNIE_FEATURES[key]] : [];
  return {
    recording: key,
    artists: [{ artist: 'jennie', rank: 'main' }, ...featured.map((artist) => ({ artist, rank: 'featured' as const }))],
  };
};

const RUBY = [
  'ruby/intro-jane',
  'ruby/like-jennie',
  'ruby/start-a-war',
  'ruby/handlebars',
  'ruby/with-the-ie',
  'ruby/extral',
  'ruby/mantra',
  'ruby/love-hangover',
  'ruby/zen',
  'ruby/damn-right',
  'ruby/fts',
  'ruby/filter',
  'ruby/seoul-city',
  'ruby/starlight',
  'ruby/twin',
];

const LANE_1 = ['tt-recording', 'lane/1-to-10', 'lane/ponytail', 'lane/jelly-jelly', 'lane/pit-a-pat', 'lane/next-page', 'lane/one-in-a-million'];

const SEOUL = { country: 'KR', city: 'Seúl' } as const;

/** A tour, by its key, its title and its main artist, as each of its concerts names it. */
interface TourOfConcert {
  key: string;
  title: string;
  artist: string;
}

const BORN_PINK: TourOfConcert = { key: 'born-pink-world-tour', title: 'Born Pink World Tour', artist: 'blackpink' };
const MAP_OF_THE_SOUL: TourOfConcert = { key: 'map-of-the-soul-tour', title: 'Map of the Soul Tour', artist: 'bts' };
export const STEAL_THE_WIND: TourOfConcert = { key: 'steal-the-wind', title: 'Steal the Wind', artist: 'txt' };

/** A concert of a tour, titled after the tour and its city, with the tour's main artist. */
export const concert = (
  tour: TourOfConcert,
  key: string,
  status: EventStatus,
  startDate: PartialDateValue,
  place: Pick<EventSpec, 'country' | 'city' | 'venue'>,
): EventSpec => ({
  key,
  title: `${tour.title} en ${place.city}`,
  status,
  tour: tour.key,
  startDate,
  ...place,
  artists: [{ artist: tour.artist, role: 'main' }],
});

export const KPOP_RELEASES_AND_TOURS: SeedSubmission[] = [
  {
    author: 'editor',
    description: 'Alta de Born Pink, segundo álbum de estudio de BLACKPINK, con sus pistas y su productor',
    sources: [wiki('Born_Pink')],
    recordings: [
      recording('born-pink/pink-venom', 'Pink Venom'),
      recording('born-pink/typa-girl', 'Typa Girl'),
      recording('born-pink/yeah-yeah-yeah', 'Yeah Yeah Yeah'),
      recording('born-pink/hard-to-love', 'Hard to Love'),
      recording('born-pink/the-happiest-girl', 'The Happiest Girl'),
      recording('born-pink/tally', 'Tally'),
      recording('born-pink/ready-for-love', 'Ready for Love'),
    ],
    releaseGroups: [
      {
        key: 'born-pink',
        title: 'Born Pink',
        type: 'album',
        artists: ['blackpink'],
        releases: [
          {
            releaseDate: day(2022, 9, 16),
            // Producer of every track, per the album's credits.
            credits: [{ identity: 'teddy', role: 'producer' }],
            tracks: tracks(
              'born-pink/pink-venom',
              'shut-down-recording',
              'born-pink/typa-girl',
              'born-pink/yeah-yeah-yeah',
              'born-pink/hard-to-love',
              'born-pink/the-happiest-girl',
              'born-pink/tally',
              'born-pink/ready-for-love',
            ),
          },
        ],
      },
    ],
  },
  {
    author: 'contributor',
    description: 'Alta de Twicecoaster: Lane 1, tercer EP de TWICE, con su edición tailandesa',
    sources: [wiki('Twicecoaster:_Lane_1')],
    recordings: [
      recording('lane/1-to-10', '1 to 10'),
      recording('lane/ponytail', 'Ponytail'),
      recording('lane/jelly-jelly', 'Jelly Jelly'),
      recording('lane/pit-a-pat', 'Pit-A-Pat'),
      recording('lane/next-page', 'Next Page'),
      recording('lane/one-in-a-million', 'One in a Million'),
    ],
    releaseGroups: [
      {
        key: 'twicecoaster-lane-1',
        title: 'Twicecoaster: Lane 1',
        type: 'ep',
        artists: ['twice'],
        releases: [
          { releaseDate: day(2016, 10, 24), tracks: tracks(...LANE_1) },
          // A CD with a bonus DVD; the article does not list its tracks.
          { editionName: 'Thailand Edition', releaseDate: day(2017, 3, 17) },
        ],
      },
    ],
  },
  {
    author: 'contributor',
    description: 'Alta de Twicecoaster: Lane 2, reedición de Twicecoaster: Lane 1 con «Knock Knock»',
    sources: [wiki('Twicecoaster:_Lane_2')],
    recordings: [recording('lane/knock-knock', 'Knock Knock'), recording('lane/ice-cream', 'Ice Cream')],
    releaseGroups: [
      {
        key: 'twicecoaster-lane-2',
        title: 'Twicecoaster: Lane 2',
        type: 'ep',
        repackageOf: 'twicecoaster-lane-1',
        artists: ['twice'],
        releases: [{ releaseDate: day(2017, 2, 20), tracks: tracks('lane/knock-knock', 'lane/ice-cream', ...LANE_1) }],
      },
    ],
  },
  {
    author: 'editor',
    description: 'Alta de Ruby, álbum de Jennie, con sus ediciones estándar, Clean y The Complete Collection',
    sources: [wiki('Ruby_(Jennie_album)')],
    people: [
      { key: 'fkj', displayName: 'FKJ', artist: true },
      { key: 'dua-lipa', displayName: 'Dua Lipa', artist: true },
      { key: 'doechii', displayName: 'Doechii', artist: true },
      { key: 'dominic-fike', displayName: 'Dominic Fike', artist: true },
      { key: 'childish-gambino', displayName: 'Childish Gambino', artist: true },
      { key: 'kali-uchis', displayName: 'Kali Uchis', artist: true },
    ],
    recordings: [
      recording('ruby/intro-jane', 'Intro: Jane'),
      recording('ruby/like-jennie', 'Like Jennie'),
      recording('ruby/start-a-war', 'Start a War'),
      recording('ruby/handlebars', 'Handlebars'),
      recording('ruby/with-the-ie', 'With the IE (Way Up)'),
      recording('ruby/extral', 'ExtraL'),
      recording('ruby/mantra', 'Mantra'),
      recording('ruby/love-hangover', 'Love Hangover'),
      recording('ruby/zen', 'Zen'),
      recording('ruby/damn-right', 'Damn Right'),
      recording('ruby/fts', 'F.T.S.'),
      recording('ruby/filter', 'Filter'),
      recording('ruby/seoul-city', 'Seoul City'),
      recording('ruby/starlight', 'Starlight'),
      recording('ruby/twin', 'Twin'),
      recording('ruby/like-jennie-extended-remix', 'Like Jennie (Extended Remix)'),
      recording('ruby/like-jennie-edm-remix', 'Like Jennie (EDM Remix)'),
      recording('ruby/handlebars-just-jennie', 'Handlebars (Just Jennie)'),
      recording('ruby/extral-just-jennie', 'ExtraL (Just Jennie)'),
      recording('ruby/love-hangover-just-jennie', 'Love Hangover (Just Jennie)'),
      recording('ruby/damn-right-just-jennie', 'Damn Right (Just Jennie)'),
    ],
    releaseGroups: [
      {
        key: 'ruby',
        title: 'Ruby',
        type: 'album',
        artists: ['jennie'],
        releases: [
          { releaseDate: day(2025, 3, 7), tracks: RUBY.map(rubyTrack) },
          // Without «F.T.S.»; the article gives no date.
          { editionName: 'Clean', tracks: RUBY.filter((key) => key !== 'ruby/fts').map(rubyTrack) },
          {
            editionName: 'The Complete Collection',
            releaseDate: day(2026, 3, 6),
            // Six bonus tracks before the original ones.
            tracks: [
              ...tracks(
                'ruby/like-jennie-extended-remix',
                'ruby/like-jennie-edm-remix',
                'ruby/handlebars-just-jennie',
                'ruby/extral-just-jennie',
                'ruby/love-hangover-just-jennie',
                'ruby/damn-right-just-jennie',
              ),
              ...RUBY.map(rubyTrack),
            ],
          },
        ],
      },
    ],
  },
  {
    author: 'deleted',
    description: 'Alta de Fifty Fifty y de «Cupid», con su versión Twin y la edición Sped Up',
    sources: [wiki('Cupid_(Fifty_Fifty_song)'), wiki('Fifty_Fifty_(group)')],
    organizations: [
      { key: 'attrakt', displayName: 'Attrakt', bio: 'Agencia surcoreana de Fifty Fifty.', originCountry: 'KR', types: ['agency', 'label'] },
      {
        key: 'fifty-fifty',
        displayName: 'Fifty Fifty',
        bio: 'Grupo femenino surcoreano de Attrakt.',
        founding: { year: 2022 },
        originCountry: 'KR',
        types: ['group'],
        artist: true,
        aliases: ['피프티 피프티'],
        affiliations: [{ organization: 'attrakt', type: 'agency', status: 'unknown' }],
      },
    ],
    people: [
      { key: 'adam-von-mentzer', displayName: 'Adam von Mentzer' },
      { key: 'mac-fellander-tsai', displayName: 'Mac Felländer-Tsai' },
      { key: 'louise-udin', displayName: 'Louise Udin' },
    ],
    works: [
      {
        key: 'cupid',
        title: 'Cupid',
        credits: [
          { identity: 'adam-von-mentzer', role: 'composer' },
          { identity: 'mac-fellander-tsai', role: 'composer' },
          { identity: 'louise-udin', role: 'composer' },
        ],
      },
    ],
    recordings: [
      {
        ...recording('cupid/original', 'Cupid', [{ work: 'cupid', relationType: 'performance' }]),
        description: 'Versión original, en coreano.',
        credits: [
          { identity: 'adam-von-mentzer', role: 'producer' },
          { identity: 'mac-fellander-tsai', role: 'producer' },
          { identity: 'louise-udin', role: 'producer' },
        ],
      },
      { ...recording('cupid/twin', 'Cupid (Twin Ver.)', [{ work: 'cupid', relationType: 'performance' }]), description: 'Versión en inglés.' },
      recording('cupid/instrumental', 'Cupid (Instrumental)', [{ work: 'cupid', relationType: 'performance' }]),
      recording('cupid/twin-sped-up', 'Cupid (Twin Ver.) (Sped Up)', [{ work: 'cupid', relationType: 'performance' }]),
    ],
    releaseGroups: [
      {
        key: 'cupid-single',
        title: 'Cupid',
        type: 'single',
        artists: ['fifty-fifty'],
        releases: [
          { releaseDate: day(2023, 2, 24), tracks: tracks('cupid/original', 'cupid/twin', 'cupid/instrumental') },
          { editionName: 'Sped Up', releaseDate: day(2023, 4, 10), tracks: tracks('cupid/twin-sped-up') },
        ],
      },
    ],
  },
  {
    author: 'suspended',
    description: 'Alta de BoA y de su álbum en inglés BoA, con su edición Deluxe',
    sources: [wiki('BoA_(album)'), wiki('BoA')],
    people: [
      {
        key: 'boa',
        displayName: 'BoA',
        bio: 'Cantante surcoreana de SM Entertainment.',
        givenName: 'Bo-ah',
        familyName: 'Kwon',
        birthDate: '1986-11-05',
        gender: 'female',
        nationalities: ['KR'],
        artist: true,
        aliases: ['보아', '권보아'],
      },
      { key: 'sean-garrett', displayName: 'Sean Garrett', artist: true },
    ],
    recordings: [
      recording('boa/i-did-it-for-love', 'I Did It for Love'),
      recording('boa/energetic', 'Energetic'),
      recording('boa/did-ya', 'Did Ya'),
      recording('boa/look-whos-talking', "Look Who's Talking"),
      recording('boa/eat-you-up', 'Eat You Up'),
      recording('boa/obsessed', 'Obsessed'),
      recording('boa/touched', 'Touched'),
      recording('boa/scream', 'Scream'),
      recording('boa/girls-on-top', 'Girls on Top'),
      recording('boa/dress-off', 'Dress Off'),
      recording('boa/hypnotic-dancefloor', 'Hypnotic Dancefloor'),
    ],
    releaseGroups: [
      {
        key: 'boa-album',
        title: 'BoA',
        type: 'album',
        artists: ['boa'],
        releases: [
          {
            releaseDate: day(2009, 3, 17),
            tracks: [
              {
                recording: 'boa/i-did-it-for-love',
                artists: [
                  { artist: 'boa', rank: 'main' },
                  { artist: 'sean-garrett', rank: 'featured' },
                ],
              },
              ...tracks(
                'boa/energetic',
                'boa/did-ya',
                'boa/look-whos-talking',
                'boa/eat-you-up',
                'boa/obsessed',
                'boa/touched',
                'boa/scream',
                'boa/girls-on-top',
                'boa/dress-off',
                'boa/hypnotic-dancefloor',
              ).map((track, index) => ({ ...track, number: index + 2 })),
            ],
          },
          // Released digitally on iTunes with three bonus tracks; the order of its tracklist is left out.
          { editionName: 'Deluxe', releaseDate: day(2009, 8, 31) },
        ],
      },
    ],
  },
  {
    author: 'editor',
    description: 'Alta del noveno sencillo japonés de BTS y de su tracklist original con «Bird», cancelado antes de salir',
    sources: [
      wiki('Airplane_Pt._2'),
      'https://www.soompi.com/article/1231319wpp/big-hit-entertainment-announces-final-decision-regarding-release-btss-collaboration-akb48-producer',
    ],
    releaseGroups: [
      {
        key: 'fake-love-airplane',
        title: 'Fake Love/Airplane pt.2',
        type: 'single',
        artists: ['bts'],
        releases: [
          { releaseDate: day(2018, 11, 7) },
          // Announced for November with «Bird»; Big Hit dropped the track on 16 September 2018 and changed the tracklist.
          { editionName: 'Original Tracklist', releaseDate: { year: 2018, month: 11 }, isCancelled: true },
        ],
      },
    ],
  },
  {
    author: 'moderator',
    description: 'Alta de TWS y TOMORROW X TOGETHER, y de sus próximos lanzamientos «To Us» y Perfect Storm',
    sources: [
      wiki('2026_in_South_Korean_music'),
      wiki('TWS_(group)'),
      wiki('Tomorrow_X_Together'),
      'https://www.allkpop.com/video/2026/10/tws-shares-what-it-means-to-be-ones-self-in-new-teasers-for-to-us-1792164524',
      'https://www.koreajoongangdaily.com/entertainment/tomorrow-x-together-sets-perfect-storm-release/12893866',
    ],
    organizations: [
      {
        key: 'pledis',
        displayName: 'Pledis Entertainment',
        bio: 'Agencia surcoreana de Hybe.',
        originCountry: 'KR',
        types: ['agency', 'label'],
        aliases: ['Pledis'],
      },
      {
        key: 'tws',
        displayName: 'TWS',
        bio: 'Grupo masculino surcoreano formado por Pledis Entertainment; debutó el 22 de enero de 2024 con Sparkling Blue.',
        founding: { year: 2024 },
        originCountry: 'KR',
        types: ['group'],
        artist: true,
        aliases: ['투어스'],
        affiliations: [{ organization: 'pledis', type: 'agency', status: 'current' }],
      },
      {
        key: 'txt',
        displayName: 'TOMORROW X TOGETHER',
        bio: 'Grupo masculino surcoreano de BigHit Music; debutó el 4 de marzo de 2019 con The Dream Chapter: Star.',
        founding: { year: 2019 },
        originCountry: 'KR',
        types: ['group'],
        artist: true,
        aliases: ['TXT', '투모로우바이투게더'],
        affiliations: [{ organization: 'bighit', type: 'agency', status: 'current' }],
      },
    ],
    releaseGroups: [
      {
        key: 'to-us',
        title: 'To Us',
        type: 'single',
        description: 'Segundo sencillo álbum de TWS.',
        artists: ['tws'],
        // Announced for 6 p.m. KST: its countdown goes to that instant.
        releases: [{ releaseDate: day(2026, 11, 2), releaseTime: '18:00', timezone: 'Asia/Seoul' }],
      },
      {
        key: 'perfect-storm',
        title: 'Perfect Storm',
        type: 'ep',
        description: 'Noveno EP de TOMORROW X TOGETHER, de seis pistas.',
        artists: ['txt'],
        // The hour is not announced yet: no countdown.
        releases: [{ releaseDate: day(2026, 11, 16) }],
      },
    ],
  },
  {
    author: 'contributor',
    description: 'Alta de la gira Born Pink World Tour de BLACKPINK con sus conciertos de Seúl y el cancelado de Auckland',
    sources: [wiki('Born_Pink_World_Tour'), 'https://theseoulstory.com/upcoming-event-blackpink-world-tour-born-pink-in-singapore/'],
    organizations: [
      {
        key: 'live-nation',
        displayName: 'Live Nation Entertainment',
        bio: 'Promotora de conciertos estadounidense.',
        originCountry: 'US',
        types: ['promoter'],
        aliases: ['Live Nation'],
      },
    ],
    tours: [
      {
        key: 'born-pink-world-tour',
        title: 'Born Pink World Tour',
        status: 'completed',
        startDate: day(2022, 10, 15),
        endDate: day(2023, 9, 17),
        description: 'Segunda gira mundial de BLACKPINK: 66 conciertos.',
        artists: [{ artist: 'blackpink', role: 'main' }],
        organizers: [
          { identity: 'yg', details: 'Presenta la gira' },
          { identity: 'live-nation', details: 'Promotora' },
        ],
        links: [{ label: 'Sitio oficial de BLACKPINK', url: 'https://www.blackpinkmusic.com/', purpose: 'official' }],
      },
    ],
    events: [
      concert(BORN_PINK, 'born-pink-seoul-1', 'performed', day(2022, 10, 15), { ...SEOUL, venue: 'KSPO Dome' }),
      concert(BORN_PINK, 'born-pink-seoul-2', 'performed', day(2022, 10, 16), { ...SEOUL, venue: 'KSPO Dome' }),
      // Cancelled over "unforeseen logistical challenges" before its venue was confirmed.
      concert(BORN_PINK, 'born-pink-auckland', 'cancelled', day(2023, 6, 21), { country: 'NZ', city: 'Auckland' }),
      concert(BORN_PINK, 'born-pink-seoul-finale-1', 'performed', day(2023, 9, 16), { ...SEOUL, venue: 'Gocheok Sky Dome' }),
      concert(BORN_PINK, 'born-pink-seoul-finale-2', 'performed', day(2023, 9, 17), { ...SEOUL, venue: 'Gocheok Sky Dome' }),
    ],
  },
  {
    author: 'editor',
    description: 'Alta de Map of the Soul Tour de BTS y de sus cuatro conciertos en el Estadio Olímpico de Seúl',
    sources: [wiki('Map_of_the_Soul_Tour')],
    tours: [
      {
        key: 'map-of-the-soul-tour',
        title: 'Map of the Soul Tour',
        status: 'scheduled',
        startDate: day(2020, 4, 11),
        artists: [{ artist: 'bts', role: 'main' }],
      },
    ],
    events: [11, 12, 18, 19].map((dayOfMonth) =>
      concert(MAP_OF_THE_SOUL, `map-of-the-soul-seoul-${dayOfMonth}`, 'scheduled', day(2020, 4, dayOfMonth), {
        ...SEOUL,
        venue: 'Estadio Olímpico de Seúl',
      }),
    ),
  },
  {
    author: 'contributor',
    description: 'Cancelación de los conciertos de Seúl de Map of the Soul Tour, el 27 de febrero de 2020, y de toda la gira, el 19 de agosto de 2021',
    sources: [wiki('Map_of_the_Soul_Tour')],
    fieldChanges: [
      // A cancellation keeps the last known date.
      ...[11, 12, 18, 19].map((dayOfMonth) => ({
        entry: `map-of-the-soul-seoul-${dayOfMonth}`,
        targetPath: 'events.schedule',
        value: { status: 'cancelled', startDate: day(2020, 4, dayOfMonth), startTime: null, timezone: null },
      })),
      { entry: 'map-of-the-soul-tour', targetPath: 'tours.schedule', value: { status: 'cancelled', startDate: day(2020, 4, 11), endDate: null } },
    ],
  },
  {
    author: 'moderator',
    description: 'Alta de Steal the Wind, quinta gira mundial de TOMORROW X TOGETHER, que empieza en el KSPO Dome de Seúl',
    sources: ['https://www.koreajoongangdaily.com/entertainment/tomorrow-x-together-sets-perfect-storm-release/12893866'],
    tours: [
      {
        key: 'steal-the-wind',
        title: 'Steal the Wind',
        status: 'scheduled',
        startDate: day(2026, 11, 13),
        artists: [{ artist: 'txt', role: 'main' }],
        links: [{ label: 'TOMORROW X TOGETHER en BigHit Music', url: 'https://ibighit.com/txt/', purpose: 'official' }],
      },
    ],
    events: [13, 14, 15].map((dayOfMonth) =>
      concert(STEAL_THE_WIND, `steal-the-wind-seoul-${dayOfMonth}`, 'scheduled', day(2026, 11, dayOfMonth), { ...SEOUL, venue: 'KSPO Dome' }),
    ),
  },
];
