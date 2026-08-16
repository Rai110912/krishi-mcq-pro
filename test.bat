for /f " tokens=2 "delims== %%%%I in ('wmic os get localdatetime /value') do set datetime=%%%%I  
set backup_name=www_backup_%%datetime:~0,4%%%%datetime:~4,2%%%%datetime:~6,2%%_%%datetime:~8,2%%%%datetime:~10,2%%%%datetime:~12,2%%.zip  
echo %%backup_name%%  
