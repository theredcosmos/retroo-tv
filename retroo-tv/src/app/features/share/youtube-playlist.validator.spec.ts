import { FormControl } from '@angular/forms';
import { youtubePlaylistValidator } from './share-playlist-dialog.component';

describe('youtubePlaylistValidator', () => {
  const check = (v: string) => youtubePlaylistValidator(new FormControl(v, { nonNullable: true }));

  it('accepts YouTube and YouTube Music playlist links', () => {
    expect(check('https://music.youtube.com/playlist?list=PLabc')).toBeNull();
    expect(check('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDxyz')).toBeNull();
    expect(check('music.youtube.com/playlist?list=OLAK5uy_x&si=1')).toBeNull();
  });

  it('leaves empty values to the required validator', () => {
    expect(check('')).toBeNull();
  });

  it('rejects other hosts, look-alikes and links without list=', () => {
    expect(check('https://open.spotify.com/playlist/abc')).toEqual({ ytPlaylist: true });
    expect(check('https://music.youtube.com.evil.com/playlist?list=PL')).toEqual({ ytPlaylist: true });
    expect(check('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ ytPlaylist: true });
    expect(check('not a url at all')).toEqual({ ytPlaylist: true });
  });
});
