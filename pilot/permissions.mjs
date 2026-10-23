export function permissionsFor(user){
 const pages=['sites','analytics','articles','ai','video','knowledge','content','media','releases','clients','team','billing'];
 if(user.role==='admin')pages.push('api','templates','infrastructure');
 return {pages,manageInfrastructure:user.role==='admin',manageGeoKeys:user.role==='admin',manageTeam:true};
}
