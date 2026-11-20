-- trip_photos.scene 에 animal(동물·반려동물) 추가
alter table public.trip_photos
  drop constraint if exists trip_photos_scene_check;

alter table public.trip_photos
  add constraint trip_photos_scene_check
  check (
    scene is null
    or scene in ('person', 'landscape', 'food', 'animal', 'other')
  );
