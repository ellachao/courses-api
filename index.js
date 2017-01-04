var sqlite3 = require('sqlite3').verbose();
var express = require('express');
var url = require('url');
var redis = require('redis');
var fs = require('fs');
var path = require('path');

var file = 'courses_api.db';
var exists = fs.existsSync(file);

if (!exists) {
	console.log('Missing db file')
	return new Error('');
}

var db = new sqlite3.Database(file);
var redisClient = redis.createClient();
redisClient.on('error', function (err) {
    console.log("Error " + err);
});


var app = express();

var map = {
    'term': ['term_code','section'],
    'crn': ['crn','section'],
    'department': ['subj_code','section'],
    'number': ['crse_numb','section'],
    'section': ['sect_numb','section'],
    'title': ['crse_title','section'],
    'seats': ['max_enroll','section'],
    'enrollment': ['num_enrolled','section'],
    'distribution': ['distr_text','distribution'], 
    'instructor': ['instructor', 'instructor'],
    'days': ['day', 'schedule']   
}


app.get('/', function (req, res) {
	res.sendFile(path.join(__dirname, './index.html'));
});

app.get('/courses/', function(req, res) {
	var queryData = url.parse(req.url, true).query;
	if (Object.keys(queryData).length===0){
		var query = '';
	}
	else {
		var query = formQuery(queryData);
	}
	console.log(query);
	redisClient.get(query, function(err, result) {
		if (result) {
			res.json(JSON.parse(result));
		}
		else {
			var base = 'SELECT section.term_code as term, section.crn, section.subj_code, section.crse_numb, section.sect_numb as section, \
			section.crse_title as title, section.max_enroll as seats, section.num_enrolled as enrollment, instructor.first_name, \
			instructor.last_name, distribution.distr_text, schedule.ssrmeet_begin_time, schedule.ssrmeet_end_time,\
			schedule.ssrmeet_bldg_code, schedule.ssrmeet_room_code, schedule.ssrmeet_mon_day, schedule.ssrmeet_tue_day, schedule.ssrmeet_wed_day,\
			schedule.ssrmeet_thu_day, schedule.ssrmeet_fri_day FROM section INNER JOIN instructor ON \
			(section.term_code=instructor.term_code AND section.crn=instructor.crn) INNER JOIN distribution ON \
			(section.term_code=distribution.term_code AND section.crn=distribution.crn) INNER JOIN schedule ON \
			(section.term_code=schedule.term_code AND section.crn=schedule.crn)'
			db.all(base+query, function(err, rows){
				if (!err) {
					result={}
					for (var i=0; i<rows.length; i++) {
						var begin_time = rows[i]['ssrmeet_begin_time'];
						var end_time = rows[i]['ssrmeet_end_time'];
						var id = rows[i]['term']+rows[i]['crn'];
						var days = rows[i]['ssrmeet_mon_day']+rows[i]['ssrmeet_tue_day']+rows[i]['ssrmeet_wed_day']+rows[i]['ssrmeet_thu_day']+rows[i]['ssrmeet_fri_day'];
						var times = begin_time.substring(0,begin_time.length-2)+':'+begin_time.substring(begin_time.length-2,begin_time.length)+'-'+end_time.substring(0,end_time.length-2)+':'+end_time.substring(end_time.length-2,end_time.length);
						if (!(id in result)) {
							var newObj = {
								'term': rows[i]['term'],
								'crn': rows[i]['crn'],
								'course': rows[i]['subj_code']+rows[i]['crse_numb'],
								'section': rows[i]['section'],
								'title': rows[i]['title'],
								'seats': rows[i]['seats'],
								'enrollment': rows[i]['enrollment'],
								'instructor': rows[i]['first_name']+' '+rows[i]['last_name'],
								'distribution': rows[i]['distr_text'],
								'meeting time(s)': days +' - '+ times,
								'location': rows[i]['ssrmeet_bldg_code']+rows[i]['ssrmeet_room_code']
							};
							result[id]=newObj;
						}
						else {
							if (result[id]['meeting time(s)'].indexOf(days)==-1 || result[id]['meeting time(s)'].indexOf(times)==-1) {
								result[id]['meeting time(s)']+='; '+days+' - '+times;
							}
							if (result[id]['location'].indexOf(rows[i]['ssrmeet_bldg_code'])==-1 || result[id]['location'].indexOf(rows[i]['ssrmeet_room_code'])==-1) {
								result[id]['location']+='; ' +rows[i]['ssrmeet_bldg_code']+rows[i]['ssrmeet_room_code'];
							}
							if (result[id]['distribution'].indexOf(rows[i]['distr_text'])==-1) {
								result[id]['distribution']+='; '+rows[i]['distr_text'];
							}
							if (result[id]['instructor'].indexOf(rows[i]['last_name'])==-1) {
								result[id]['instructor']+='; '+rows[i]['first_name']+' '+rows[i]['last_name']
							}
						}
					}
					list=[]
					for (var k in result) {
						list.push(result[k]);
					}
					redisClient.setex(query,600,JSON.stringify(list));
					res.json(list);
				} 
				else {
					console.log(err);
					res.end('Error');
				}
			});
		}
	});
});


function formQuery(args){
	var result=' WHERE'
	for (var i in args) {
		if (i in map) {
			if (i=='days'){
				var dayString=args[i];
				for (var j=0; j<dayString.length; j++) {
					if (result.length>6) {
						result+=' AND'
					}
					if (dayString[j]=='M') {
						result +=" schedule.ssrmeet_mon_day='M'";
					}
					else if (dayString[j]=='T') {
						result +=" schedule.ssrmeet_tue_day='T'";
					}
					else if (dayString[j]=='W') {
						result +=" schedule.ssrmeet_wed_day='W'";
					}
					else if (dayString[j]=='R') {
						result +=" schedule.ssrmeet_thu_day='R'";
					}
					else {
						result +=" schedule.ssrmeet_fri_day='F'";
					}
				}
			}
			else if (i=='instructor'){
				if (result.length>6) {
					result+=' AND'
				}
				var name=args[i].split(' ');
				if (name.length==2) {
					result +=" instructor.first_name='"+name[0]+"'"+" AND instructor.last_name='"+name[1]+"'";
				}
				else {
					result +=" instructor.first_name='"+name[0]+"'"+" OR instructor.last_name='"+name[0]+"'";	
				}
			}
			else if (i=='title'){
				if (result.length>6) {
					result+=' AND'
				}
				result +=" section.crse_title"+" LIKE '%"+args[i]+"%'";
			}
			else {
				if (result.length>6) {
					result+=' AND'
				}
				result+=' '+map[i][1]+'.'+map[i][0]+'='+"'"+args[i]+"'";
			}
		}
	}
	//TO DO: figure out different way to do this
	if ('limit' in args) {
			result += ' LIMIT '+parseInt(args['limit'])*3;
		} 
	return result;
}

var server = app.listen(8000, function() {
	console.log('Server listening on port ' + server.address().port);
});