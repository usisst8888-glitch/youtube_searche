-- user_id (uuid FK) 로 대체된 legacy 컬럼 정리

drop index if exists story_angles_user_code_idx;
alter table story_angles drop column if exists user_code;
